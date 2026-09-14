import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Repairs sloppy EPUBs before they reach epubjs.
 *
 * Real-world EPUBs (publisher exports, Calibre conversions, …) often
 * reference files with a different letter case than the actual zip entries
 * (`href="TOC.NCX"` while the entry is `toc.ncx`, …). Zip lookups are
 * case-sensitive, so epubjs then fails with `File not found in the epub`
 * — notably for the TOC/nav file, whose load failure also escapes as an
 * unhandled promise rejection from inside epubjs.
 *
 * This pass unzips with fflate, rewrites mismatched `href`/`src` values in
 * the OPF manifest plus the NCX/nav documents to the real entry names
 * (case-insensitive match), and re-zips. Well-formed books are returned
 * untouched (same buffer reference), and anything unexpected bails out to
 * the original bytes — a broken book must never become *more* broken.
 */

const CONTAINER_PATH = "META-INF/container.xml";
const ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** XML layer (injectable so Node-based tests can supply an implementation). */
export interface EpubXmlEnv {
  parseXml(text: string): Document | null;
  serializeXml(doc: Document): string;
}

function defaultEnv(): EpubXmlEnv | null {
  const Parser = globalThis.DOMParser;
  const Serializer = globalThis.XMLSerializer;
  if (typeof Parser === "undefined" || typeof Serializer === "undefined") return null;
  return {
    parseXml: (text: string) => {
      const doc = new Parser().parseFromString(text, "application/xml");
      return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
    },
    serializeXml: (doc: Document) => new Serializer().serializeToString(doc),
  };
}

/** Normalizes a zip entry name for comparison (separators, `./`, leading `/`). */
export function normalizeZipName(name: string): string {
  let result = name.replace(/\\/g, "/");
  while (result.startsWith("./")) result = result.slice(2);
  if (result.startsWith("/") && !result.startsWith("//")) result = result.slice(1);
  return result;
}

function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function relativeHref(fromDir: string, target: string): string {
  if (!fromDir) return target;
  const from = fromDir.split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  return [...Array<string>(from.length - shared).fill(".."), ...to.slice(shared)].join("/");
}

/** Resolves one `href`/`src` value against the referencing file's directory.
 *  Returns the corrected attribute value, or null when it needs no change
 *  (external URL, fragment-only, exact match) or can't be fixed (missing). */
function fixReference(
  raw: string,
  refDir: string,
  findActual: (path: string) => string | null,
): string | null {
  const hashIndex = raw.indexOf("#");
  const pathPart = hashIndex < 0 ? raw : raw.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? "" : raw.slice(hashIndex);
  if (!pathPart || ABSOLUTE_URL.test(pathPart)) return null;
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  const resolved = normalizePosix(refDir ? `${refDir}/${decoded}` : decoded);
  const actual = findActual(resolved);
  if (!actual) return null;
  if (normalizeZipName(actual) === resolved) return null;
  return relativeHref(refDir, normalizeZipName(actual)) + fragment;
}

function fixAttributes(
  doc: Document,
  tag: string,
  attribute: string,
  refDir: string,
  findActual: (path: string) => string | null,
): boolean {
  let changed = false;
  const elements = doc.getElementsByTagName(tag);
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element) continue;
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const fixed = fixReference(value, refDir, findActual);
    if (fixed !== null && fixed !== value) {
      element.setAttribute(attribute, fixed);
      changed = true;
    }
  }
  return changed;
}

function sanitize(data: ArrayBuffer, env: EpubXmlEnv): ArrayBuffer {
  const bytes = new Uint8Array(data);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return data;
  }
  const names = Object.keys(entries);
  if (names.length === 0) return data;

  const byNormalized = new Map<string, string>();
  const byLower = new Map<string, string>();
  for (const actual of names) {
    const normalized = normalizeZipName(actual);
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, actual);
    const lower = normalized.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, actual);
  }
  const findActual = (path: string): string | null => {
    const exact = byNormalized.get(path);
    if (exact !== undefined) return exact;
    return byLower.get(path.toLowerCase()) ?? null;
  };

  const containerBytes = entries[CONTAINER_PATH];
  if (!containerBytes) return data;
  const containerDoc = env.parseXml(strFromU8(containerBytes));
  const rootfile = containerDoc?.getElementsByTagName("rootfile")[0];
  const opfHref = rootfile?.getAttribute("full-path");
  if (!opfHref) return data;
  const opfActual = findActual(normalizePosix(opfHref));
  if (!opfActual || !entries[opfActual]) return data;

  const opfDir = dirname(normalizeZipName(opfActual));
  const opfDoc = env.parseXml(strFromU8(entries[opfActual] as Uint8Array));
  if (!opfDoc) return data;

  const opfChanged = fixAttributes(opfDoc, "item", "href", opfDir, findActual);
  if (opfChanged) {
    entries[opfActual] = strToU8(env.serializeXml(opfDoc));
  }

  // Second pass over the (possibly rewritten) manifest: repair the links
  // inside NCX and EPUB3 nav documents the same way, and strip nav/ncx
  // items that genuinely don't exist in the archive (broken export).
  let navChanged = false;
  const items = opfDoc.getElementsByTagName("item");
  const toRemove: Element[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const mediaType = (item.getAttribute("media-type") ?? "").toLowerCase();
    const properties = (item.getAttribute("properties") ?? "").toLowerCase();
    const isNcx = mediaType === "application/x-dtbncx+xml";
    const isNav = properties.split(/[\s,]+/).includes("nav");
    if (!isNcx && !isNav) continue;
    const href = item.getAttribute("href");
    if (!href) continue;
    const [pathPart] = [href.split("#")[0] as string];
    if (!pathPart || ABSOLUTE_URL.test(pathPart)) continue;
    let decoded = pathPart;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      // Keep going with the raw value.
    }
    const docActual = findActual(normalizePosix(opfDir ? `${opfDir}/${decoded}` : decoded));
    if (!docActual || !entries[docActual]) {
      // Nav/ncx file missing from archive — remove from manifest so
      // epubjs never tries to request it.
      toRemove.push(item);
      navChanged = true;
      continue;
    }
    const doc = env.parseXml(strFromU8(entries[docActual] as Uint8Array));
    if (!doc) continue;
    const docDir = dirname(normalizeZipName(docActual));
    const changed = isNcx
      ? fixAttributes(doc, "content", "src", docDir, findActual)
      : fixAttributes(doc, "a", "href", docDir, findActual);
    if (changed) {
      entries[docActual] = strToU8(env.serializeXml(doc));
      navChanged = true;
    }
  }
  for (const item of toRemove) {
    item.parentNode?.removeChild(item);
  }
  // If nav items were removed from the DOM, re-serialize the updated
  // manifest back into the archive entries.
  if (toRemove.length > 0) {
    entries[opfActual] = strToU8(env.serializeXml(opfDoc));
  }

  // Nothing rewritten anywhere: the archive is fine — hand back the
  // original bytes untouched (zero behavior change for good books).
  if (!opfChanged && !navChanged) return data;

  // Re-zip with `mimetype` first and uncompressed, per the EPUB spec.
  const out: Record<string, Uint8Array> = {};
  const mimetypeActual = byNormalized.get("mimetype");
  if (mimetypeActual && entries[mimetypeActual]) {
    out["mimetype"] = entries[mimetypeActual] as Uint8Array;
  }
  for (const name of names) {
    if (name === mimetypeActual) continue;
    out[name] = entries[name] as Uint8Array;
  }
  // fflate honors insertion order; force `mimetype` stored (level 0).
  if (mimetypeActual) {
    const ordered: Record<string, Uint8Array | [Uint8Array, { level: number }]> = {
      mimetype: [out["mimetype"] as Uint8Array, { level: 0 }],
    };
    for (const name of Object.keys(out)) {
      if (name === "mimetype") continue;
      ordered[name] = out[name] as Uint8Array;
    }
    const packed = zipSync(ordered as Record<string, Uint8Array>);
    return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
  }
  const packed = zipSync(out);
  return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
}

/** Repairs a possibly-sloppy EPUB archive (see module doc). Never throws
 *  and never returns unusable bytes: on any doubt the input is returned. */
export async function sanitizeEpubArchive(data: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const env = defaultEnv();
    if (!env) return data;
    return sanitize(data, env);
  } catch {
    return data;
  }
}

/** Same as {@link sanitizeEpubArchive} with an injectable XML layer (used
 *  by Node-based tests, where no DOM exists). */
export async function sanitizeEpubArchiveWith(data: ArrayBuffer, env: EpubXmlEnv): Promise<ArrayBuffer> {
  try {
    return sanitize(data, env);
  } catch {
    return data;
  }
}
