/**
 * Converts the rendered HTML of an EPUB section into Markdown so the Lexical
 * editor can re-import it with its structure preserved: headings stay
 * headings, lists stay lists, quotes/emphasis/code/tables survive, etc.
 *
 * With `{ plain: true }` it produces translation input instead: inline
 * formatting markers (`**`, `*`, `~~`, `~`, `^`) and link syntax are dropped
 * so the AI rebuilds clean Markdown from plain text — only the structural
 * markers (`#`, `-`, `>`, tables, code fences) and code identity (backticks /
 * fences) are kept. Code blocks are preserved as fenced blocks and short code
 * fragments as inline backticks so the model can reconstruct the correct
 * Markdown structure even when EPUBs use inconsistent HTML for code.
 *
 * Images are handled through `epubHtmlToPlainTextWithImages`: each `<img>` is
 * replaced by a `[IMG-n]` placeholder (so the AI never receives the image),
 * and the resolved image references are returned separately to re-insert the
 * real markdown images into the translated output at the same positions.
 */

const SKIPPED_TAGS = new Set([
  "audio",
  "button",
  "canvas",
  "form",
  "head",
  "iframe",
  "input",
  "link",
  "meta",
  "nav",
  "noscript",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

/** Block-ish wrappers whose children are collected individually. */
const CONTAINER_TAGS = new Set([
  "article",
  "div",
  "figcaption",
  "figure",
  "footer",
  "header",
  "main",
  "section",
]);

const HEADING_TAG_RE = /^h([1-6])$/;

/** Tags whose content is inline (never block-nested inside a list item). */
const INLINE_CONTEXT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "img",
  "ins",
  "kbd",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr",
]);

/** An image found in the chapter, referenced by its `[IMG-n]` placeholder. */
export interface EpubImageRef {
  /** The placeholder token as it appears in the extracted text. */
  token: string;
  /** Resolved image URL (ready to load in the app document). */
  src: string;
  /** The image's alt text (may be empty). */
  alt: string;
  /** Ready-to-use markdown fragment, e.g. `![alt](src)`. */
  markdown: string;
}

function isHidden(el: Element): boolean {
  const style = (el as HTMLElement).style;
  return (
    el.hasAttribute("hidden") ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    el.getAttribute("aria-hidden") === "true"
  );
}

/** Collapses whitespace of a raw text node to single spaces. */
function textOf(node: Node): string {
  return (node.textContent ?? "").replace(/\s+/g, " ");
}

/** Rasterizes an `<img>` to a data URL via a canvas created in the image's
 *  own document. epubjs serves images from blob URLs bound to the section
 *  frame's opaque origin — the app document cannot load them — but inside
 *  that frame the image is same-origin, so the canvas is not tainted. */
function rasterizeImg(img: HTMLImageElement, doc: Document, src: string): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!(w > 0 && h > 0)) return null;
  try {
    const canvas = doc.createElement("canvas");
    const MAX_EDGE = 1600;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const isJpeg = /\.jpe?g($|\?)/i.test(src);
    const dataUrl = isJpeg
      ? canvas.toDataURL("image/jpeg", 0.9)
      : canvas.toDataURL("image/png");
    return dataUrl && dataUrl.length > 24 ? dataUrl : null;
  } catch {
    return null;
  }
}

/** Resolves the `<img>` src for use outside the EPUB frame. Data URLs are
 *  passed through; blob URLs (opaque origin) are rasterized to a data URL. */
function imgSrcForDisplay(el: Element): string {
  const raw = el.getAttribute("src");
  if (!raw || !raw.trim()) return "";
  let src: string;
  try {
    src = new URL(raw, el.baseURI).href;
  } catch {
    src = raw;
  }
  if (src.startsWith("data:")) return src;
  const rasterized = rasterizeImg(el as HTMLImageElement, el.ownerDocument, src);
  return rasterized ?? src;
}

function imgMarkdown(src: string, alt: string): string {
  const label = (alt.replace(/\]/g, "\\]").replace(/\s+/g, " ").trim() || "image");
  return `![${label}](${src})`;
}

/** Heuristic: whether a raw code string should be a fenced block rather than inline.
 *  EPUBs use wildly different HTML for code — this is content-based so it
 *  does not depend on a specific tag structure. [IMG-n] preservation is untouched.
 *  Thresholds are intentionally conservative so short hooks like
 *  `useState` or `const [x,setX]=useState(true)` stay inline, while JSX-heavy
 *  or long statements become fenced blocks. */
function isBlockCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\n")) return true;
  // Persian example: `export function important() { return <div>...</div>; }` ~76 chars
  if (trimmed.length > 70) return true;
  // JSX / HTML tag inside code — needs a bit more length to avoid promoting tiny tags like `<br/>`
  if (trimmed.length > 55 && /<\/?[a-zA-Z][^>]*>/.test(trimmed)) return true;
  // Braces / semicolons — typical multi-statement JS line
  if (trimmed.length > 60 && /[{};]/.test(trimmed) && /[A-Za-z]/.test(trimmed)) return true;
  // Keyword-heavy line (function, return, export, etc.)
  if (trimmed.length > 60 && /\b(function|return|export|import|const|let|var|class|interface|extends)\b/.test(trimmed))
    return true;
  return false;
}

function fenceFor(text: string): string {
  return text.includes("```") ? "````" : "```";
}

/** Text for the inline content of a node (no block structure, no markers
 *  when `plain` is set). */
function inline(node: Node, plain: boolean, images: EpubImageRef[] | null): string {
  if (node.nodeType === Node.TEXT_NODE) return textOf(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIPPED_TAGS.has(tag) || isHidden(el)) return "";

  const text = (): string => inlineChildren(el, plain, images).replace(/\s+/g, " ").trim();
  const wrap = (marker: string): string => {
    const inner = text();
    return inner ? `${marker}${inner}${marker}` : "";
  };

  switch (tag) {
    case "br":
      return plain ? " " : "\n";
    case "img": {
      if (images) {
        const src = imgSrcForDisplay(el);
        if (src) {
          const alt = el.getAttribute("alt") ?? "";
          const token = `[IMG-${images.length}]`;
          images.push({ token, src, alt, markdown: imgMarkdown(src, alt) });
          return token;
        }
      }
      return el.getAttribute("alt") ?? "";
    }
    case "strong":
    case "b":
      return plain ? text() : wrap("**");
    case "em":
    case "i":
      return plain ? text() : wrap("*");
    case "code":
    case "kbd":
    case "samp":
    case "tt":
    case "var": {
      if (!plain) return codeSpan(el);
      const raw = (el.textContent ?? "").replace(/\r\n?/g, "\n").trim();
      if (!raw) return "";
      if (isBlockCode(raw)) {
        const fence = fenceFor(raw);
        // Surrounding blank lines ensure the fence is parsed as a block even
        // when it was inline inside a <p> or <li>.
        return `\n\n${fence}\n${raw}\n${fence}\n\n`;
      }
      const escaped = raw.includes("`") ? raw.replace(/`/g, "'") : raw;
      return `\`${escaped}\``;
    }
    case "del":
    case "s":
    case "strike":
      return plain ? text() : wrap("~~");
    case "sub":
      return plain ? text() : wrap("~");
    case "sup":
      return plain ? text() : wrap("^");
    case "u":
    case "ins":
      return text();
    case "a": {
      const inner = inlineChildren(el, plain, images).trim();
      if (!inner) return "";
      if (plain) return inner;
      const href = el.getAttribute("href");
      return href ? `[${inner}](${href})` : inner;
    }
    default: {
      // EPUBs are inconsistent: code is sometimes <div class="code">,
      // <span style="font-family:monospace">, <pre> without <code>, etc.
      // Preserve code identity even without a <code> tag when the container
      // looks code-like and its text is block-code. [IMG-n] stays untouched.
      if (plain) {
        const cls = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`.toLowerCase();
        const style = (el.getAttribute("style") ?? "").toLowerCase();
        const looksCode =
          /code|pre|syntax|highlight|hljs|language-|source-code|monospace|consolas|courier/.test(cls) ||
          /monospace|consolas|courier|code/.test(style);
        if (looksCode) {
          const raw = (el.textContent ?? "").replace(/\r\n?/g, "\n").trim();
          // Only promote when the whole element is code-like and block-sized;
          // otherwise fall through to normal inlineChildren so prose is kept.
          const isEntirelyCode =
            raw &&
            isBlockCode(raw) &&
            // Avoid misfiring on a normal paragraph that merely contains the word "code"
            (el.childElementCount === 0 || raw.length > 40);
          if (isEntirelyCode) {
            const fence = fenceFor(raw);
            return `\n\n${fence}\n${raw}\n${fence}\n\n`;
          }
        }
      }
      return inlineChildren(el, plain, images);
    }
  }
}

/** Concatenates the inline text of a node's children. The original text
 *  nodes carry the author's spacing, so parts join verbatim. */
function inlineChildren(el: Element, plain: boolean, images: EpubImageRef[] | null): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    const part = inline(child, plain, images);
    if (part) out += part;
  }
  return out;
}

function codeSpan(el: Element): string {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.includes("`") ? `\`\`\` ${text} \`\`\`` : `\`${text}\``;
}

/** Collects the top-level Markdown blocks found inside `container`. */
function collectBlocks(
  container: Node,
  blocks: string[],
  plain: boolean,
  images: EpubImageRef[] | null,
): void {
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = textOf(node).trim();
      if (text) blocks.push(text);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(tag) || isHidden(el)) continue;

    if (CONTAINER_TAGS.has(tag)) {
      collectBlocks(el, blocks, plain, images);
      continue;
    }

    const heading = tag.match(HEADING_TAG_RE);
    if (tag === "p") {
      const text = inline(el, plain, images).trim();
      if (text) blocks.push(text);
    } else if (heading) {
      const text = inline(el, plain, images).trim();
      if (text) blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
    } else if (tag === "hr") {
      blocks.push("---");
    } else if (tag === "ul" || tag === "ol") {
      blocks.push(...renderList(el, 0, plain, images));
    } else if (tag === "blockquote") {
      blocks.push(...renderQuote(el, plain, images));
    } else if (tag === "pre") {
      blocks.push(renderCodeBlock(el));
    } else if (tag === "table") {
      const table = renderTable(el, plain, images);
      if (table) blocks.push(table);
    } else if (INLINE_CONTEXT_TAGS.has(tag)) {
      const text = inline(el, plain, images).trim();
      if (text) blocks.push(text);
    } else {
      // Unknown wrapper — its children determine the structure (a bare text
      // container simply yields a paragraph via the TEXT_NODE branch).
      collectBlocks(el, blocks, plain, images);
    }
  }
}

/** Renders a `<ul>`/`<ol>` (with nesting) as flat markdown list lines. */
function renderList(
  listEl: Element,
  depth: number,
  plain: boolean,
  images: EpubImageRef[] | null,
): string[] {
  const ordered = listEl.tagName.toLowerCase() === "ol";
  const lines: string[] = [];
  let index = 1;
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") {
      collectBlocks(child, lines, plain, images);
      continue;
    }
    const marker = ordered ? `${index}. ` : "- ";
    const runs: string[] = [];
    const nested: string[] = [];
    for (const liChild of Array.from(child.childNodes)) {
      if (liChild.nodeType === Node.TEXT_NODE) {
        const text = textOf(liChild).trim();
        if (text) runs.push(text);
        continue;
      }
      if (liChild.nodeType !== Node.ELEMENT_NODE) continue;
      const innerTag = (liChild as Element).tagName.toLowerCase();
      if (innerTag === "ul" || innerTag === "ol") {
        nested.push(...renderList(liChild as Element, depth + 1, plain, images));
      } else {
        const part = inline(liChild, plain, images).trim();
        if (part) runs.push(part);
      }
    }
    const indent = "  ".repeat(depth);
    const text = runs.join(" ");
    if (text) lines.push(`${indent}${marker}${text}`);
    lines.push(...nested);
    index += 1;
  }
  return lines;
}

/** Renders a `<blockquote>`; every output line is prefixed with `>`. */
function renderQuote(blockquote: Element, plain: boolean, images: EpubImageRef[] | null): string[] {
  const inner: string[] = [];
  collectBlocks(blockquote, inner, plain, images);
  if (inner.length === 0) return [];
  return inner.map((block) =>
    block
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n"),
  );
}

/** Language of a `<pre>` code block. Books disagree where it lives: a
 *  `language-*` class on a wrapping `<code>` child, data attributes
 *  (`data-code-language`, `data-language`, …) or a `lang` attribute on the
 *  `<pre>` itself. Syntax-highlight token classes (`kr`, `nx`, `o`, …) are
 *  not languages and are ignored. */
function detectCodeLanguage(pre: Element, code: Element | null): string {
  const fromClasses = (el: Element | null): string => {
    if (!el) return "";
    for (const cls of Array.from(el.classList)) {
      const match = cls.match(/^(?:language|lang)-([a-zA-Z0-9_+-]+)$/);
      if (match) return match[1];
    }
    return "";
  };
  return (
    fromClasses(code) ||
    fromClasses(pre) ||
    pre.getAttribute("data-code-language")?.trim() ||
    pre.getAttribute("data-language")?.trim() ||
    pre.getAttribute("data-lang")?.trim() ||
    pre.getAttribute("lang")?.trim() ||
    ""
  );
}

/** Text of a `<pre>` block with `<br>` elements kept as newlines
 *  (`textContent` alone would swallow them and join lines together). */
function preTextContent(pre: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName.toLowerCase() === "br") out += "\n";
      else for (const child of Array.from(el.childNodes)) walk(child);
    }
  };
  for (const child of Array.from(pre.childNodes)) walk(child);
  return out;
}

function renderCodeBlock(pre: Element): string {
  // Highlighted books split code token-by-token into many sibling `<code>`
  // spans (`<code class="kr">const</code> <code class="nx">http</code> …).
  // Only treat a `<code>` child as the block when it alone wraps the whole
  // content — otherwise `querySelector("code")` returns just the first token
  // ("const") and the rest of the code is silently dropped.
  const codeEls = Array.from(pre.querySelectorAll("code"));
  const singleWrapper =
    codeEls.length === 1 &&
    (pre.textContent ?? "").trim() === (codeEls[0].textContent ?? "").trim();
  const code = singleWrapper ? codeEls[0] : null;
  const language = detectCodeLanguage(pre, code);
  const text = preTextContent(pre)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  const fence = text.includes("```") ? "````" : "```";
  return `${fence}${language}\n${text}\n${fence}`;
}

/** Renders a `<table>` as a GFM markdown table (first row = header). */
function renderTable(table: Element, plain: boolean, images: EpubImageRef[] | null): string | null {
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children)
      .filter((cell) => /^t[dh]$/i.test(cell.tagName))
      .map((cell) => inline(cell, plain, images).replace(/\n/g, " ").trim().replace(/\|/g, "-")),
  );
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  if (rows.length < 2) return null;
  const pad = (row: string[]) =>
    `| ${Array.from({ length: colCount }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [pad(rows[0]), `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n");
}

function joinBlocks(blocks: string[]): string {
  return blocks
    .join("\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface EpubMarkdownOptions {
  /** Plain-text mode for AI translation input: inline formatting markers
   *  (`**`, `*`, `~~`, `~`, `^`) and link syntax are dropped; only the
   *  structural markers (`#`, `-`, `>`, tables, code fences) and code identity
   *  (short inline backticks / fenced blocks for long code) remain. */
  plain?: boolean;
}

/** Main entry: `container` is the rendered body of the current EPUB section. */
export function epubHtmlToMarkdown(
  container: HTMLElement,
  options: EpubMarkdownOptions = {},
): string {
  const { plain = false } = options;
  const blocks: string[] = [];
  collectBlocks(container, blocks, plain, null);
  return joinBlocks(blocks);
}

/** Translation input for the current EPUB section: plain text with `[IMG-n]`
 *  placeholders where images appear, plus the resolved image references so
 *  the images can be re-inserted into the translated Markdown afterwards. */
export function epubHtmlToPlainTextWithImages(container: HTMLElement): {
  text: string;
  images: EpubImageRef[];
} {
  const images: EpubImageRef[] = [];
  const blocks: string[] = [];
  collectBlocks(container, blocks, true, images);
  return { text: joinBlocks(blocks), images };
}

/** Upper bound for one cleaned-HTML AI request (serialized characters).
 *  HTML carries tag overhead around the same words, so the budget is larger
 *  than the plain-text chunker's — chapters usually still fit in one chunk. */
const MAX_HTML_CHUNK = 20000;

/** Cleaned chapter HTML plus the images replaced by `[IMG-n]` tokens. */
export interface EpubHtmlExtraction {
  /** Cleaned-HTML chunks: sequences of complete elements, never
   *  cut mid-tag, one AI request each. */
  chunks: string[];
  /** Images found in the chapter, keyed by their placeholder token. */
  images: EpubImageRef[];
}

/** Attributes worth sending to the AI. Everything else — `class`, `id`,
 *  inline styles, event handlers, `epub:type`, `title`, the rest of `data-*`
 *  — is noise the model tends to echo back into its output, so it is
 *  stripped. Structural signal survives through the tags themselves. */
const KEPT_HTML_ATTRIBUTES = new Set([
  "href",
  "src",
  "lang",
  "xml:lang",
  "dir",
  "start",
  "colspan",
  "rowspan",
  "data-code-language",
]);

function stripNoisyAttributes(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    if (!KEPT_HTML_ATTRIBUTES.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
  }
}

/** Moves a `language-*` / `lang-*` class hint onto `data-code-language`
 *  before classes are stripped, so the code language survives as the one
 *  attribute the model is told to read. Only for `pre` / `code` elements
 *  that do not already carry an explicit hint. */
function promoteCodeLanguage(el: Element): void {
  if (el.hasAttribute("data-code-language")) return;
  const tag = el.tagName.toLowerCase();
  if (tag !== "pre" && tag !== "code") return;
  for (const cls of Array.from(el.classList)) {
    const match = cls.match(/^(?:language|lang)-([a-zA-Z0-9_+-]+)$/);
    if (match) {
      el.setAttribute("data-code-language", match[1]);
      return;
    }
  }
}

/** Neutral wrappers with no semantics of their own (their attributes are
 *  stripped anyway): when one exceeds the chunk budget, its children become
 *  separate items instead of forcing the whole subtree into a single chunk.
 *  Distinct from `CONTAINER_TAGS` above — semantic elements (lists, tables,
 *  code, quotes, figures, notes) always stay whole, even when oversized, so
 *  a request never receives half a table or half a code block. */
const SPLITTABLE_CONTAINER_TAGS = new Set(["article", "div", "footer", "header", "main", "section"]);

/** Translation input for EPUB chapters that skips Markdown conversion: the
 *  chapter's cleaned original HTML (scripts, styles and hidden content
 *  removed, images replaced by `[IMG-n]` tokens), split into request-sized
 *  chunks of complete top-level elements. The live DOM is never mutated —
 *  everything happens on a detached clone. */
export function epubHtmlToCleanedHtmlWithImages(container: HTMLElement): EpubHtmlExtraction {
  const images: EpubImageRef[] = [];
  const clone = container.cloneNode(true) as HTMLElement;
  // Paired walk over the live tree and the clone (same structure, so child
  // indices correspond): rasterization reads the rendered originals while
  // all edits land on the clone.
  const clean = (origParent: Node, copyParent: Node): void => {
    const origKids = Array.from(origParent.childNodes);
    const copyKids = Array.from(copyParent.childNodes);
    for (let index = 0; index < copyKids.length; index += 1) {
      const orig = origKids[index];
      const copy = copyKids[index];
      if (!orig || !copy) continue;
      if (copy.nodeType !== Node.ELEMENT_NODE || orig.nodeType !== Node.ELEMENT_NODE) continue;
      const origEl = orig as Element;
      const copyEl = copy as Element;
      const tag = copyEl.tagName.toLowerCase();
      if (SKIPPED_TAGS.has(tag) || isHidden(origEl)) {
        copyParent.removeChild(copy);
        continue;
      }
      if (tag === "img") {
        const src = imgSrcForDisplay(origEl);
        const doc = copyEl.ownerDocument;
        if (src) {
          const alt = origEl.getAttribute("alt") ?? "";
          const token = `[IMG-${images.length}]`;
          images.push({ token, src, alt, markdown: imgMarkdown(src, alt) });
          copyParent.replaceChild(doc.createTextNode(token), copy);
        } else {
          copyParent.replaceChild(doc.createTextNode(origEl.getAttribute("alt") ?? ""), copy);
        }
        continue;
      }
      promoteCodeLanguage(copyEl);
      stripNoisyAttributes(copyEl);
      clean(origEl, copyEl);
    }
  };
  clean(container, clone);

  // Flatten oversized neutral wrappers (a chapter wrapped in one giant
  // <div> is the norm, not the exception): their children become separate
  // items, so long chapters still split into several requests and the UI
  // keeps showing per-chunk progress. Anything semantic stays whole.
  const items: string[] = [];
  const collectItems = (parent: Node): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text.trim()) items.push(text);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const serialized = el.outerHTML;
      if (
        SPLITTABLE_CONTAINER_TAGS.has(el.tagName.toLowerCase()) &&
        serialized.length > MAX_HTML_CHUNK &&
        el.childNodes.length > 0
      ) {
        collectItems(el);
        continue;
      }
      // A single oversized element stays whole — splitting it mid-tag would
      // produce broken markup and defeat the purpose of this mode.
      items.push(serialized);
    }
  };
  collectItems(clone);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentSize = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    chunks.push(current.join("\n\n"));
    current = [];
    currentSize = 0;
  };
  for (const item of items) {
    if (currentSize > 0 && currentSize + item.length + 2 > MAX_HTML_CHUNK) flush();
    current.push(item);
    currentSize += item.length + 2;
  }
  flush();
  return { chunks, images };
}

/** Replaces each `[IMG-n]` placeholder in AI output with the image's markdown,
 *  in order. Placeholders the model dropped are skipped; ones it duplicated
 *  repeat the image. */
export function replaceImageTokens(markdown: string, images: EpubImageRef[]): string {
  let out = markdown;
  for (const image of images) {
    out = out.replaceAll(image.token, image.markdown);
  }
  return out;
}

/** Protocol URL prefix for translation images. */
const TRANSLATION_IMG_PROTOCOL = "readlynx-translation-image://local/";

/** Extracts the data-URL body from an `EpubImageRef` so it can be persisted
 *  to the FileStore. Returns null if the src is not a data URL. */
export function extractDataUrlFromImageRef(ref: EpubImageRef): string | null {
  if (ref.src.startsWith("data:")) return ref.src;
  return null;
}

/** Builds a protocol URL for a stored translation image. */
export function translationImageUrl(bookId: string, chapterKey: string, imgIndex: number, ext: string): string {
  return `${TRANSLATION_IMG_PROTOCOL}${bookId}/${chapterKey}/${imgIndex}.${ext}`;
}

/** Builds a translated markdown string with `[IMG-n]` tokens replaced by
 *  protocol URLs pointing at persisted images. Use this when saving a
 *  translation to the database so cached rows contain resolvable URLs. */
export function replaceImageTokensWithProtocolUrls(
  markdown: string,
  images: EpubImageRef[],
  protocolUrls: string[],
): string {
  let out = markdown;
  for (let i = 0; i < images.length; i++) {
    const url = protocolUrls[i];
    if (!url) continue;
    const alt = (images[i].alt || "image").replace(/\]/g, "\\]").replace(/\s+/g, " ").trim();
    const md = `![${alt}](${url})`;
    out = out.replaceAll(images[i].token, md);
  }
  return out;
}

/** Whether an inline code span should have been a fenced block. Shared by
 *  the plain-mode extractor and the post-translation normalizer so both use
 *  the same content-based heuristic regardless of EPUB tag variance. */
function shouldPromoteInlineCode(raw: string): boolean {
  return isBlockCode(raw);
}

/** Post-processes translated Markdown: promotes long/code-like inline spans
 *  (e.g. `` `export function important() { return <div>...</div>; }` ``) to
 *  proper fenced blocks. This is model-agnostic — it fixes AI variance where
 *  a long snippet was returned as inline despite the prompt.
 *
 *  Fenced blocks themselves are left untouched, and `[IMG-n]` placeholders
 *  are preserved verbatim for the later `replaceImageTokens` step. */
export function normalizeTranslatedMarkdown(markdown: string): string {
  if (!markdown || !markdown.includes("`")) return markdown;
  // Split by existing fenced blocks so we never rewrite inside them.
  const fenceRe = /(````[\s\S]*?````|```[\s\S]*?```)/g;
  const parts = markdown.split(fenceRe);
  for (let i = 0; i < parts.length; i += 2) {
    // Even indices are outside fences
    const text = parts[i];
    if (!text.includes("`")) continue;
    parts[i] = text.replace(/`([^`\n]+?)`/g, (match, inner: string) => {
      const raw = inner.trim();
      if (!raw) return match;
      if (!shouldPromoteInlineCode(raw)) return match;
      const fence = raw.includes("```") ? "````" : "```";
      // Light language hint: JSX-flavoured code gets tsx for nicer highlighting
      const looksJsx = /<\/?[a-zA-Z][^>]*>/.test(raw) && /\b(function|return|const|let|export|import|class)\b/.test(raw);
      const lang = looksJsx ? "tsx" : "";
      return `\n\n${fence}${lang}\n${raw}\n${fence}\n\n`;
    });
  }
  let out = parts.join("");
  // Collapse the blank lines we introduced without touching intentional structure.
  out = out.replace(/\n{4,}/g, "\n\n\n").replace(/[ \t]+$/gm, "").trim();
  // Normalize 3+ newlines that may have appeared at promotion boundaries
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

/** Block-level tags: a leaked one marks a paragraph boundary, so it becomes
 *  a blank line instead of gluing the surrounding words together. */
const LEAKED_BLOCK_TAG_RE =
  /<\/?(?:p|div|h[1-6]|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|blockquote|pre|section|article|header|footer|figure|figcaption|aside|main|nav|hr|br)(?:\s[^<>]*)?\/?>/gi;

/** Any other tag shape (`<span …>`, `</a>`, …): its inner text (if any) is
 *  already in the flow, so only the markup itself is dropped. The strict
 *  tag-name pattern keeps autolinks (`<https://…>`) and math (`a < b`)
 *  untouched. */
const LEAKED_INLINE_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;

/** Entity-encoded tags (`&lt;div&gt;`) some models emit instead of literal
 *  markup: decoded back to tag shape first, so the rules above catch them.
 *  Only complete tag patterns are touched — `&lt;3` or `a &lt; b` survive. */
const LEAKED_ENTITY_TAG_RE = /&lt;(\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^;<>]*)?\/?)&gt;/g;

function stripLeakedTagsOutsideCode(text: string): string {
  // Inline code spans may legitimately show tags as teaching examples
  // (`` `<div>` ``) — only the prose around them is cleaned.
  const bits = text.split(/(`[^`\n]*?`)/g);
  for (let i = 0; i < bits.length; i += 2) {
    let seg = bits[i].replace(/<!--[\s\S]*?-->/g, "");
    seg = seg.replace(LEAKED_ENTITY_TAG_RE, "<$1>");
    seg = seg.replace(LEAKED_BLOCK_TAG_RE, "\n\n");
    seg = seg.replace(LEAKED_INLINE_TAG_RE, "");
    bits[i] = seg.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "");
  }
  return bits.join("");
}

/** Removes HTML tags a model echoed into its Markdown output despite being
 *  told not to (e.g. `<h6>`, `epub:type="note">` fragments, `&lt;table&gt;`
 *  entities, stray `</div>`). Fenced code blocks and inline code spans are
 *  left untouched — a `<div>` inside code is legitimate content, not a leak.
 *  `[IMG-n]` placeholders contain no angle brackets and pass through. */
export function stripLeakedHtmlTags(markdown: string): string {
  if (!markdown || (!markdown.includes("<") && !markdown.includes("&lt;"))) return markdown;
  // Split by existing fenced blocks so code examples are never rewritten.
  const fenceRe = /(````[\s\S]*?````|```[\s\S]*?```)/g;
  const parts = markdown.split(fenceRe);
  for (let i = 0; i < parts.length; i += 2) {
    // Even indices are outside fences
    parts[i] = stripLeakedTagsOutsideCode(parts[i]);
  }
  return parts.join("");
}