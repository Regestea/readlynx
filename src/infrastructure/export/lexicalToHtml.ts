import { $generateHtmlFromNodes } from "@lexical/html";
import { $getRoot, $isElementNode, type LexicalEditor } from "lexical";

/**
 * Lexical JSON -> semantic HTML conversion.
 *
 * All document nodes (headings, paragraphs, lists, tables, images, code
 * blocks, links, inline formatting and the custom callout/page-break nodes)
 * are serialised through their own `exportDOM` implementations, so the
 * semantic structure is preserved verbatim. Paged.js then re-flows this
 * fragment into physical pages — no measuring, no fake page breaks here.
 */

export interface LexicalToHtmlOptions {
  /** Document title used for the generated `<title>` / running headers. */
  title?: string;
  /** Mark every `h1` (except the document opener) with `rl-chapter-start`
   *  so PrintStyles can start each chapter on a new page. */
  chapterBreaks?: boolean;
}

/** Serialise the editor state into a semantic HTML body fragment. */
export function toHtml(editor: LexicalEditor, options: LexicalToHtmlOptions = {}): string {
  const { html, directions } = editor.read(() => {
    const html = $generateHtmlFromNodes(editor);
    // Record the per-block bidi direction, if any, so it can be re-applied as
    // `dir` attributes after serialization. `ElementNode.exportDOM` already
    // emits `dir`, but only when the direction was set on the node; this
    // makes the export independent of that and closes the gap for blocks the
    // AutoDirectionPlugin hasn't reached yet.
    const directions: Array<"rtl" | "ltr" | null> = [];
    for (const child of $getRoot().getChildren()) {
      directions.push($isElementNode(child) ? child.getDirection() ?? null : null);
    }
    return { html, directions };
  });

  const applyChapterBreaks = options.chapterBreaks === true;
  const hasDirs = directions.some((direction) => direction !== null);
  if (!applyChapterBreaks && !hasDirs) {
    return html;
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const topLevel = Array.from(doc.body.children);

  if (applyChapterBreaks) {
    // Deterministic chapter-break marking: add `rl-chapter-start` to every
    // `h1` except the very first one in the document. The opening chapter
    // must not create a leading blank page; every following chapter starts
    // on a fresh page.
    topLevel
      .filter((element) => element.tagName === "H1")
      .forEach((heading, index) => {
        if (index > 0) {
          heading.classList.add("rl-chapter-start");
        }
      });
  }

  // Each top-level Lexical block exports to exactly one top-level element, so
  // the indices align. If they ever diverge (e.g. an exotic node exporting a
  // fragment), fail safe and keep whatever the serializer already emitted.
  if (hasDirs && directions.length === topLevel.length) {
    topLevel.forEach((element, index) => {
      const direction = directions[index];
      if (direction !== null) {
        element.setAttribute("dir", direction);
      }
    });
  }

  return doc.body.innerHTML;
}

/**
 * Assemble a complete standalone HTML document around a body fragment.
 * Used by tests, the generic HTML export and as the base for the paginated
 * PDF document before Paged.js runs.
 */
export function toDocumentHtml(
  bodyHtml: string,
  options: LexicalToHtmlOptions & {
    /** CSS text placed in `<head>` before pagination runs. */
    styles?: string;
    /** `@page` rule text (size + margins) for non-paged consumers. */
    pageRule?: string;
  } = {},
): string {
  const { title = "Document", styles = "", pageRule = "" } = options;
  const pageStyle = pageRule
    ? `\n${pageRule}\n`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; }
      ${pageStyle}
      ${styles}
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
