/**
 * Converts the rendered HTML of an EPUB section into Markdown so the Lexical
 * editor can re-import it with its structure preserved: headings stay
 * headings, lists stay lists, quotes/emphasis/code/tables survive, etc.
 *
 * With `{ plain: true }` it produces translation input instead: inline
 * formatting markers (`**`, `*`, `~~`, `~`, `^`, backticks) and link syntax
 * are dropped so the AI rebuilds clean Markdown from plain text — only the
 * structural markers (`#`, `-`, `>`, tables, code fences) are kept.
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
      return plain ? text() : codeSpan(el);
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
    default:
      return inlineChildren(el, plain, images);
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

function renderCodeBlock(pre: Element): string {
  const codeEl = pre.querySelector("code");
  const target = codeEl ?? pre;
  let language = "";
  for (const cls of Array.from(target.classList)) {
    const match = cls.match(/^language-([a-zA-Z0-9_+-]+)$/);
    if (match) {
      language = match[1];
      break;
    }
  }
  const text = (target.textContent ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
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
   *  (`**`, `*`, `~~`, `~`, `^`, backticks) and link syntax are dropped;
   *  only structural markers (`#`, `-`, `>`, tables, code fences) remain. */
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