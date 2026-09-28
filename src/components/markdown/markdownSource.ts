/**
 * Source-level preparation for AI-written Markdown.
 *
 * Translations routinely contain HTML or JSX snippets — a code sample about
 * React, a stray `<div>` the model invented — and rendering those as live
 * markup both looks wrong and lets the model inject elements into the reader.
 * Escaping the angle brackets in the *source* is the cheapest way to guarantee
 * it: the text still reads exactly as written, and the parser never sees a tag.
 *
 * `<br>` is deliberately spared. It is the one tag with no meaning as literal
 * text and no Markdown equivalent — a table cell needs it to break a line —
 * so it is stashed behind a sentinel across the escape and restored after.
 */

/** Stands in for a `<br>` while the angle brackets are escaped. A control
 *  character cannot appear in real prose. */
const BR_SENTINEL = "\u0000rlx:br\u0000";

/** `<br>`, `<br/>`, `<br />` — the only tag that survives escaping. */
const BR_RE = /<br\s*\/?>/gi;

/** Escapes the `<` of every angle bracket on one line, leaving inline code
 *  spans untouched so `` `<div>` `` keeps teaching what it means. */
function escapeHtmlInLine(line: string): string {
  let out = "";
  let index = 0;
  while (index < line.length) {
    const tick = line.indexOf("`", index);
    if (tick === -1) {
      out += line.slice(index).replace(/</g, "&lt;");
      break;
    }
    out += line.slice(index, tick).replace(/</g, "&lt;");
    let run = 0;
    while (tick + run < line.length && line[tick + run] === "`") run += 1;
    const closing = line.indexOf("`".repeat(run), tick + run);
    if (closing === -1) {
      out += line.slice(tick).replace(/</g, "&lt;");
      break;
    }
    out += line.slice(tick, closing + run);
    index = closing + run;
  }
  return out;
}

/**
 * Prepares AI-written Markdown for a renderer that must not execute embedded
 * markup: every `<` outside a fenced code block or an inline code span becomes
 * `&lt;`, so HTML/JSX snippets render as the literal text they are — except
 * `<br>`, which stays a real line break.
 */
export function escapeHtmlInMarkdown(markdown: string): string {
  if (!markdown.includes("<")) return markdown;
  // Protect the line breaks first so the escape below cannot touch them.
  const guarded = markdown.replace(BR_RE, BR_SENTINEL);
  const lines = guarded.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      const marker = match[1][0];
      if (fence === null) {
        fence = marker;
      } else if (fence === marker) {
        fence = null;
      }
      out.push(line);
      continue;
    }
    out.push(fence ? line : escapeHtmlInLine(line));
  }
  return out.join("\n").replaceAll(BR_SENTINEL, "<br>");
}

/**
 * Flattens rendered React children back to plain text.
 *
 * Needed to decide a block's direction: react-markdown hands over an *array*
 * of nodes for anything that mixes text with inline markup, so a table cell
 * holding Persian text plus a `<br>` or a `<strong>` arrives as a tree, not
 * a string. Reading only a direct string child would leave those cells with no
 * direction at all and let them inherit the page's, which is how an RTL cell
 * ends up left-aligned.
 */
export function textOfChildren(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(textOfChildren).join("");
  if (children && typeof children === "object") {
    const props = (children as { props?: { children?: unknown } }).props;
    if (props && props.children !== undefined) return textOfChildren(props.children);
  }
  return "";
}
