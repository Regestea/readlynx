import ePub from "epubjs";
import type { Book } from "epubjs";
import { sanitizeEpubArchive } from "../../../shared/document/epubSanitize";
import {
  epubHtmlToCleanedHtmlWithImages,
  epubHtmlToPlainTextWithImages,
} from "../../../shared/document/epubToMarkdown";
import type { EpubImageRef } from "../../../shared/document/epubToMarkdown";
import { chunkChapter } from "./epubChunker.ts";
import type { EpubExtractionMode } from "./types.ts";

/**
 * Headless EPUB chapter reader, used by the Manage translations dialog to
 * list and translate chapters without driving the on-screen viewer.
 *
 * The reader's own `EpubViewerHandle` only exposes the chapter it currently
 * renders, so translating "the whole book" would mean paging through the
 * visible rendition (the user would watch the book flip chapter by chapter).
 * This module opens its own `Book` instance and reads spine documents
 * directly, which keeps the reading view untouched.
 *
 * Chapters are read straight out of the archive rather than through
 * `Section.load()`: epubjs's DOM hooks (`replaceBase` and friends) throw on
 * XHTML chapters that have no `<head>`, which rejects the load. The raw
 * markup is fetched from the zip and the archive's own resource substitution
 * is applied to it, so `<img src>` already points at a real (blob:) URL that
 * `fetch` can read — no image has to be rendered or rasterized to persist it
 * into the translation.
 */

/** A chapter of the book, as listed in the Manage translations dialog. */
export interface EpubChapterInfo {
  /** Spine index — the same key the reader and the translation cache use. */
  index: number;
  key: string;
  title: string;
}

/** A chapter's translation input, already split into request-sized pieces. */
export interface EpubChapterContent {
  /** One AI request each — chunked plain text, or the chapter's cleaned
   *  original HTML split at element boundaries (never mid-tag). */
  chunks: string[];
  images: EpubImageRef[];
}

export interface EpubContents {
  /** Every spine chapter, in reading order. Cheap: no chapter is parsed. */
  listChapters(): EpubChapterInfo[];
  /** Reads one chapter's translation input. Returns null when unavailable. */
  readChapter(index: number, extraction: EpubExtractionMode): Promise<EpubChapterContent | null>;
  /** Releases the archive and its blob URLs. */
  close(): void;
}

/** How long a broken nav/ncx may stall `book.opened` before giving up. */
const OPEN_TIMEOUT_MS = 8000;

/** epubjs's `Section`, reduced to what the headless reader needs. The class is
 *  not re-exported from the package root, so its shape is declared here. */
interface EpubSection {
  index: number;
  /** Archive-relative path of the section, e.g. `/OEBPS/ch1.xhtml`. */
  url: string;
}

/** The zip epubjs unzipped the book into. */
interface EpubArchiveLike {
  getText(url: string): Promise<string> | undefined;
}

/** epubjs's resource table, which knows the blob URL of every image. */
interface EpubResourcesLike {
  substitute(content: string, url: string): string;
}

function spineSection(book: Book, target: string | number): EpubSection | null {
  return (book.spine.get(target) as unknown as EpubSection | null) ?? null;
}

function bookArchive(book: Book): EpubArchiveLike | null {
  return (book as unknown as { archive?: EpubArchiveLike }).archive ?? null;
}

function bookResources(book: Book): EpubResourcesLike | null {
  return (book as unknown as { resources?: EpubResourcesLike }).resources ?? null;
}

/** Flattens a TOC (which nests) into one list of entries, depth first. */
function flattenToc(
  items: Array<{ label?: string; href?: string }>,
  out: Array<{ label: string; href: string }>,
): void {
  for (const item of items) {
    if (!item || typeof item.href !== "string") continue;
    out.push({ label: (item.label ?? "").trim(), href: item.href });
    const nested = (item as { subitems?: Array<{ label?: string; href?: string }> }).subitems;
    if (Array.isArray(nested)) flattenToc(nested, out);
  }
}

/** Maps a TOC href onto its spine index. epubjs normalizes the URL, so a
 *  plain string compare handles relative vs. absolute manifest hrefs. */
function spineIndexForHref(book: Book, href: string): number | null {
  try {
    const section = spineSection(book, href);
    if (section && typeof section.index === "number") return section.index;
  } catch {
    // An unresolvable TOC entry simply has no title.
  }
  return null;
}

/** Chapter title: the first TOC label pointing at the chapter, else the
 *  chapter's own `<title>` / first heading (only read while translating), and
 *  finally a positional label. */
function titleForIndex(index: number, titlesByIndex: Map<number, string>): string {
  return titlesByIndex.get(index) || `Chapter ${index + 1}`;
}

/** Reads a chapter's title out of its own document — used only when the book
 *  ships no usable table of contents. */
function titleFromDocument(doc: Document): string {
  const heading = doc.querySelector("h1, h2, h3, title");
  const text = (heading?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.slice(0, 120);
}

/** Raw markup of one section, read straight from the archive's zip. */
async function readSectionMarkup(book: Book, url: string): Promise<string | null> {
  const archive = bookArchive(book);
  if (!archive || !url) return null;
  try {
    const text = await archive.getText(url);
    return typeof text === "string" && text ? text : null;
  } catch {
    return null;
  }
}

/** Rewrites the section's relative resource references (images, stylesheets)
 *  into the blob URLs epubjs created for them — the same substitution the
 *  renderer applies through its serialize hook. */
function substituteResources(book: Book, markup: string, url: string): string {
  const resources = bookResources(book);
  if (!resources) return markup;
  try {
    return resources.substitute(markup, url);
  } catch {
    // Unsubstituted references simply stay relative and are dropped later.
    return markup;
  }
}

/** Parses a chapter's markup. XHTML is tried first so self-closing tags
 *  survive; the lenient HTML parser is the fallback for files that are not
 *  well-formed XML. A parser error document is never returned. */
function parseChapterMarkup(markup: string): HTMLElement | null {
  const parser = new DOMParser();
  const mimes = ["application/xhtml+xml", "text/html"] as const;
  for (const mime of mimes) {
    try {
      const doc = parser.parseFromString(markup, mime);
      if (doc.querySelector("parsererror")) continue;
      const body = chapterBody(doc);
      if (body) return body;
    } catch {
      // Try the next parser.
    }
  }
  return null;
}

/** The chapter's body element. `Document.body` only exists on HTML
 *  documents, so an XHTML-parsed chapter needs the explicit lookup; the root
 *  element is the last resort and is safe because the extractors skip
 *  `<head>`. */
function chapterBody(doc: Document): HTMLElement | null {
  const candidates = [
    (doc as HTMLDocument).body,
    doc.getElementsByTagName("body")[0],
    doc.documentElement,
  ];
  for (const candidate of candidates) {
    if (candidate) return candidate as HTMLElement;
  }
  return null;
}

/** Opens the EPUB at `filePath` for headless chapter access. Throws when the
 *  file cannot be read or parsed. */
export async function openEpubContents(filePath: string): Promise<EpubContents> {
  const bytes = await window.readlynx?.readFileBytes(filePath);
  if (!bytes) throw new Error("Could not read the EPUB. The file may have been moved.");
  const book = ePub(await sanitizeEpubArchive(bytes));
  // `book.ready` resolves before the archive's resource replacements finish;
  // `book.opened` is the promise that guarantees the image URLs are in place.
  await Promise.race([
    book.opened,
    new Promise<void>((resolve) => window.setTimeout(resolve, OPEN_TIMEOUT_MS)),
  ]);

  const titlesByIndex = new Map<number, string>();
  try {
    const toc = (book.navigation?.toc ?? []) as Array<{ label?: string; href?: string }>;
    const flat: Array<{ label: string; href: string }> = [];
    flattenToc(toc, flat);
    for (const entry of flat) {
      if (!entry.label) continue;
      const index = spineIndexForHref(book, entry.href);
      if (index !== null && !titlesByIndex.has(index)) titlesByIndex.set(index, entry.label);
    }
  } catch {
    // A broken TOC is not fatal — chapters fall back to positional labels.
  }

  let closed = false;
  return {
    listChapters(): EpubChapterInfo[] {
      const spine = (book.spine as unknown as { spineItems?: unknown[] }).spineItems ?? [];
      return spine.map((_item, index) => ({
        index,
        key: String(index),
        title: titleForIndex(index, titlesByIndex),
      }));
    },
    async readChapter(
      index: number,
      extraction: EpubExtractionMode,
    ): Promise<EpubChapterContent | null> {
      if (closed) return null;
      const section = spineSection(book, index);
      if (!section) return null;
      const markup = await readSectionMarkup(book, section.url);
      if (!markup) return null;
      const body = parseChapterMarkup(substituteResources(book, markup, section.url));
      if (!body) return null;
      if (!titlesByIndex.has(index)) {
        const own = titleFromDocument(body.ownerDocument);
        if (own) titlesByIndex.set(index, own);
      }
      if (extraction === "html") {
        const { chunks, images } = epubHtmlToCleanedHtmlWithImages(body);
        if (chunks.length === 0) return null;
        return { chunks, images };
      }
      const { text, images } = epubHtmlToPlainTextWithImages(body);
      if (!text.trim()) return null;
      return { chunks: chunkChapter(text), images };
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        book.destroy();
      } catch {
        // Destroying a partially opened book must never break the dialog.
      }
    },
  };
}

/**
 * Reads an `EpubImageRef` into a data URL so it can be persisted in the
 * FileStore. Uses the data URL the extractor may already have produced,
 * otherwise fetches the (blob:) URL — the headless reader never renders the
 * image, so rasterization is not available here.
 */
export async function imageRefToDataUrl(ref: EpubImageRef): Promise<string | null> {
  const src = ref.src ?? "";
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
