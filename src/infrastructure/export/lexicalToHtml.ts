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
 *
 * This is the only Lexical-aware piece of the export pipeline: everything
 * downstream works on the HTML string it returns (see `htmlDocument.ts`).
 */

export interface LexicalToHtmlOptions {
  /** Document title used for the generated `<title>` / running headers. */
  title?: string;
}

/** Serialise the editor state into a semantic HTML body fragment. */
export function toHtml(editor: LexicalEditor, options: LexicalToHtmlOptions = {}): string {
  void options;
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

  if (!directions.some((direction) => direction !== null)) {
    return html;
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const topLevel = Array.from(doc.body.children);

  // Each top-level Lexical block exports to exactly one top-level element, so
  // the indices align. If they ever diverge (e.g. an exotic node exporting a
  // fragment), fail safe and keep whatever the serializer already emitted.
  if (directions.length === topLevel.length) {
    topLevel.forEach((element, index) => {
      const direction = directions[index];
      if (direction !== null) {
        element.setAttribute("dir", direction);
      }
    });
  }

  return doc.body.innerHTML;
}
