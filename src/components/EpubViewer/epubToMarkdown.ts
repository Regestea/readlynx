/**
 * Converts the rendered HTML of an EPUB section into Markdown so the Lexical
 * editor can re-import it with its structure preserved: headings stay
 * headings, lists stay lists, quotes/emphasis/code/tables survive, etc.
 *
 * With `{ plain: true }` it produces translation input instead: inline
 * formatting markers (`**`, `*`, `~~`, `~`, `^`, backticks) and link syntax
 * are dropped so the AI rebuilds clean Markdown from plain text — only the
 * structural markers (`#`, `-`, `>`, tables, code fences) are kept.
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

/** Text for the inline content of a node (no block structure, no markers
 *  when `plain` is set). */
function inline(node: Node, plain: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) return textOf(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIPPED_TAGS.has(tag) || isHidden(el)) return "";

  const text = (): string => inlineChildren(el, plain).replace(/\s+/g, " ").trim();
  const wrap = (marker: string): string => {
    const inner = text();
    return inner ? `${marker}${inner}${marker}` : "";
  };

  switch (tag) {
    case "br":
      return plain ? " " : "\n";
    case "img":
      return el.getAttribute("alt") ?? "";
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
      const inner = inlineChildren(el, plain).trim();
      if (!inner) return "";
      if (plain) return inner;
      const href = el.getAttribute("href");
      return href ? `[${inner}](${href})` : inner;
    }
    default:
      return inlineChildren(el, plain);
  }
}

/** Concatenates the inline text of a node's children. The original text
 *  nodes carry the author's spacing, so parts join verbatim. */
function inlineChildren(el: Element, plain: boolean): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    const part = inline(child, plain);
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
function collectBlocks(container: Node, blocks: string[], plain: boolean): void {
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
      collectBlocks(el, blocks, plain);
      continue;
    }

    const heading = tag.match(HEADING_TAG_RE);
    if (tag === "p") {
      const text = inline(el, plain).trim();
      if (text) blocks.push(text);
    } else if (heading) {
      const text = inline(el, plain).trim();
      if (text) blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
    } else if (tag === "hr") {
      blocks.push("---");
    } else if (tag === "ul" || tag === "ol") {
      blocks.push(...renderList(el, 0, plain));
    } else if (tag === "blockquote") {
      blocks.push(...renderQuote(el, plain));
    } else if (tag === "pre") {
      blocks.push(renderCodeBlock(el));
    } else if (tag === "table") {
      const table = renderTable(el, plain);
      if (table) blocks.push(table);
    } else if (INLINE_CONTEXT_TAGS.has(tag)) {
      const text = inline(el, plain).trim();
      if (text) blocks.push(text);
    } else {
      // Unknown wrapper — its children determine the structure (a bare text
      // container simply yields a paragraph via the TEXT_NODE branch).
      collectBlocks(el, blocks, plain);
    }
  }
}

/** Renders a `<ul>`/`<ol>` (with nesting) as flat markdown list lines. */
function renderList(listEl: Element, depth: number, plain: boolean): string[] {
  const ordered = listEl.tagName.toLowerCase() === "ol";
  const lines: string[] = [];
  let index = 1;
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") {
      collectBlocks(child, lines, plain);
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
        nested.push(...renderList(liChild as Element, depth + 1, plain));
      } else {
        const part = inline(liChild, plain).trim();
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
function renderQuote(blockquote: Element, plain: boolean): string[] {
  const inner: string[] = [];
  collectBlocks(blockquote, inner, plain);
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
function renderTable(table: Element, plain: boolean): string | null {
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children)
      .filter((cell) => /^t[dh]$/i.test(cell.tagName))
      .map((cell) => inline(cell, plain).replace(/\n/g, " ").trim().replace(/\|/g, "-")),
  );
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  if (rows.length < 2) return null;
  const pad = (row: string[]) =>
    `| ${Array.from({ length: colCount }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [pad(rows[0]), `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n");
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
  collectBlocks(container, blocks, plain);
  return blocks
    .join("\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
