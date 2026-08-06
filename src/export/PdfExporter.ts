import type { LexicalEditor } from "lexical";
import { PAGE_FORMATS } from "../components/ui/DocumentEditor/constants";
import { escapeHtml, toHtml } from "./LexicalToHtml";
import {
  PaginationService,
  buildPrintCss,
  collectFontFaces,
  collectPagedStyles,
  collectRootVariables,
  inlineImages,
  themeVariables,
} from "./PaginationService";
import printCss from "./PrintStyles.css?raw";
import { DEFAULT_PDF_EXPORT_OPTIONS } from "./types";
import type { PagedDocument, PdfExportOptions } from "./types";

/**
 * Top-level PDF pipeline: Lexical editor -> semantic HTML -> Paged.js
 * pagination -> standalone print-ready HTML (consumed by the Electron
 * `printToPDF` IPC, or by `window.print()` as a fallback).
 *
 * The exported HTML is a *snapshot* of the already paginated document:
 * every `.pagedjs_page` carries its final geometry, and the head replays the
 * exact rules Paged.js generated, so the hidden PDF renderer does not need
 * to run the engine again.
 */

export interface BuildPdfOptions extends PdfExportOptions {
  /** Export file name shown in the save dialog. */
  defaultPath?: string;
}

/** Run the full pipeline and produce the standalone paginated HTML document. */
export async function buildPdfDocument(
  editor: LexicalEditor,
  options: PdfExportOptions,
): Promise<PagedDocument> {
  const opts: PdfExportOptions = { ...DEFAULT_PDF_EXPORT_OPTIONS, ...options };

  const bodyHtml = toHtml(editor, { chapterBreaks: opts.chapterBreaks });
  const service = new PaginationService();
  const result = await service.paginate(bodyHtml, [
    printCss,
    themeVariables(opts),
    buildPrintCss(opts),
  ]);

  try {
    const container = result.container;
    if (opts.inlineImages) {
      await inlineImages(container);
    }

    const html = assembleStandaloneHtml({
      title: "Document",
      cssSize: PAGE_FORMATS[opts.pageFormat].cssSize,
      themeCss: themeVariables(opts),
      fontFaces: collectFontFaces(),
      baseCss: printCss,
      dynamicCss: buildPrintCss(opts),
      pagedCss: collectPagedStyles(),
      rootVarsCss: collectRootVariables(),
      pageCount: result.pageCount,
      pagesMarkup: container.innerHTML,
    });

    return {
      pageCount: result.pageCount,
      pages: result.pages,
      html,
      destroy: () => service.dispose(),
    };
  } catch (error) {
    service.dispose();
    throw new Error("Failed to build paginated PDF document", { cause: error });
  }
}

interface StandaloneHtmlInput {
  title: string;
  cssSize: string;
  themeCss: string;
  fontFaces: string;
  baseCss: string;
  dynamicCss: string;
  pagedCss: string;
  rootVarsCss: string;
  pageCount: number;
  pagesMarkup: string;
}

function assembleStandaloneHtml(input: StandaloneHtmlInput): string {
  const {
    title,
    cssSize,
    themeCss,
    fontFaces,
    baseCss,
    dynamicCss,
    pagedCss,
    rootVarsCss,
    pageCount,
    pagesMarkup,
  } = input;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style data-readlynx-root>
${themeCss}
    </style>
    <style data-readlynx-fonts>
${fontFaces}
    </style>
    <style data-readlynx-print>
${baseCss}
${dynamicCss}
    </style>
    <style data-readlynx-paged>
${pagedCss}
    </style>
    <style data-readlynx-rootvars>
${rootVarsCss}
    </style>
    <style data-readlynx-sheet>
/* Print the already-paginated pages edge-to-edge. */
@page {
  size: ${cssSize} !important;
  margin: 0 !important;
}
html, body { margin: 0; padding: 0; }
.pagedjs_page {
  page-break-after: always;
  break-after: page;
}
    </style>
    <meta name="readlynx-page-count" content="${pageCount}" />
  </head>
  <body>
${pagesMarkup}
  </body>
</html>`;
}
