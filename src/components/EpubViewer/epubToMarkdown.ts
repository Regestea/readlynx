/**
 * Converts the rendered HTML of an EPUB section into Markdown so the Lexical
 * editor can re-import it with its structure preserved: headings stay
 * headings, lists stay lists, quotes/emphasis/code/tables survive, etc.
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

/** Markdown for the inline content of a node (no block structure). */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return textOf(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIPPED_TAGS.has(tag) || isHidden(el)) return "";

  const wrap = (marker: string): string => {
    const inner = inlineChildren(el).replace(/\s+/g, " ").trim();
    return inner ? `${marker}${inner}${marker}` : "";
  };

  switch (tag) {
    case "br":
      return "\n";
    case "img":
      return el.getAttribute("alt") ?? "";
    case "strong":
    case "b":
      return wrap("**");
    case "em":
    case "i":
      return wrap("*");
    case "code":
      return codeSpan(el);
    case "del":
    case "s":
    case "strike":
      return wrap("~~");
    case "sub":
      return wrap("~");
    case "sup":
      return wrap("^");
    case "u":
    case "ins":
      return inlineChildren(el);
    case "a": {
      const inner = inlineChildren(el).trim();
      if (!inner) return "";
      const href = el.getAttribute("href");
      return href ? `[${inner}](${href})` : inner;
    }
    default:
      return inlineChildren(el);
  }
}

/** Concatenates the inline markdown of a node's children. The original text
 *  nodes carry the author's spacing, so parts join verbatim. */
function inlineChildren(el: Element): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    const part = inline(child);
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
function collectBlocks(container: Node, blocks: string[]): void {
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
      collectBlocks(el, blocks);
      continue;
    }

    const heading = tag.match(HEADING_TAG_RE);
    if (tag === "p") {
      const text = inline(el).trim();
      if (text) blocks.push(text);
    } else if (heading) {
      const text = inline(el).trim();
      if (text) blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
    } else if (tag === "hr") {
      blocks.push("---");
    } else if (tag === "ul" || tag === "ol") {
      blocks.push(...renderList(el, 0));
    } else if (tag === "blockquote") {
      blocks.push(...renderQuote(el));
    } else if (tag === "pre") {
      blocks.push(renderCodeBlock(el));
    } else if (tag === "table") {
      const table = renderTable(el);
      if (table) blocks.push(table);
    } else if (INLINE_CONTEXT_TAGS.has(tag)) {
      const text = inline(el).trim();
      if (text) blocks.push(text);
    } else {
      // Unknown wrapper — its children determine the structure (a bare text
      // container simply yields a paragraph via the TEXT_NODE branch).
      collectBlocks(el, blocks);
    }
  }
}

/** Renders a `<ul>`/`<ol>` (with nesting) as flat markdown list lines. */
function renderList(listEl: Element, depth: number): string[] {
  const ordered = listEl.tagName.toLowerCase() === "ol";
  const lines: string[] = [];
  let index = 1;
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") {
      collectBlocks(child, lines);
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
        nested.push(...renderList(liChild as Element, depth + 1));
      } else {
        const part = inline(liChild).trim();
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
function renderQuote(blockquote: Element): string[] {
  const inner: string[] = [];
  collectBlocks(blockquote, inner);
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
function renderTable(table: Element): string | null {
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children)
      .filter((cell) => /^t[dh]$/i.test(cell.tagName))
      .map((cell) => inline(cell).replace(/\n/g, " ").trim().replace(/\|/g, "-")),
  );
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  if (rows.length < 2) return null;
  const pad = (row: string[]) =>
    `| ${Array.from({ length: colCount }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [pad(rows[0]), `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n");
}

/** Main entry: `container` is the rendered body of the current EPUB section. */
export function epubHtmlToMarkdown(container: HTMLElement): string {
  const blocks: string[] = [];
  collectBlocks(container, blocks);
  return blocks
    .join("\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}