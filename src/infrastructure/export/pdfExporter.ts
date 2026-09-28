import { PAGE_FORMATS } from "../../shared/document/pageGeometry";
import { escapeHtml } from "./htmlDocument";
import {
  PaginationService,
  buildPrintCss,
  collectFontFaces,
  collectPagedStyles,
  collectRootVariables,
  inlineImages,
  themeVariables,
} from "./paginationService";
import { scaleHtmlFontSizes } from "./fontScale";
import { katexCssForExport } from "./katexExportCss";
import { paginateAvoidingEmptyPages } from "./emptyPageBreaks";
import { DEFAULT_CHAPTER_MIN_LINES } from "./types";
import { codeThemeCss, resolveDocumentMode } from "./exportTheme";
import { highlightBodyCode } from "./epubHighlight";
import printCss from "./PrintStyles.css?raw";
import { DEFAULT_PDF_EXPORT_OPTIONS } from "./types";
import type { PagedDocument, PdfExportOptions } from "./types";

/**
 * Top-level PDF pipeline: semantic HTML -> Paged.js pagination ->
 * standalone print-ready HTML (consumed by the Electron `printToPDF` IPC, or
 * by `window.print()` as a fallback).
 *
 * Source-agnostic: the caller supplies the body HTML, so both the document
 * editor and the reading view's translated books go through the exact same
 * pagination, theming and cover handling.
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

/** Chromium rejects data URLs over ~2 MB (`ERR_INVALID_URL`). High-resolution
 *  covers (e.g. a photographed first page) can exceed that, so before a cover
 *  is embedded in the export HTML it is downscaled/re-encoded until it fits.
 *  The stored cover file itself is untouched — this only affects the exported
 *  PDF. */
const MAX_COVER_EMBED_BYTES = 1_000_000;
const COVER_EMBED_MAX_WIDTH = 1600;

export async function fitCoverForExport(dataUrl: string): Promise<string> {
  const match = /^data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes <= MAX_COVER_EMBED_BYTES) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, COVER_EMBED_MAX_WIDTH / bitmap.width);
      const width = Math.max(1, Math.floor(bitmap.width * scale));
      const height = Math.max(1, Math.floor(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      bitmap.close();
    }
  } catch {
    return dataUrl;
  }
}

/** Run the full pipeline and produce the standalone paginated HTML document. */
export async function buildPdfDocument(
  bodyHtml: string,
  options: PdfExportOptions,
): Promise<PagedDocument> {
  const opts: PdfExportOptions = { ...DEFAULT_PDF_EXPORT_OPTIONS, ...options };

  const contentHtml = highlightBodyCode(
    scaleHtmlFontSizes(bodyHtml, opts.fontSizeScalePct),
  );
  const m = opts.margins;
  const coverImage = opts.coverImage ? await fitCoverForExport(opts.coverImage) : undefined;
  const coverHtml = coverImage
    ? `<div class="rl-cover-page" style="display:flex;align-items:center;justify-content:center;overflow:hidden;height:calc(100% + ${m.top + m.bottom}mm);margin:-${m.top}mm -${m.right}mm -${m.bottom}mm -${m.left}mm;page-break-after:always;break-after:page;"><img src="${escapeHtml(coverImage)}" style="width:100%;height:100%;object-fit:cover;" /></div>`
    : "";
  const paginated = `${coverHtml}${contentHtml}`;
  const katexCss = katexCssForExport();
  const codeCss = codeThemeCss(opts.codeTheme, resolveDocumentMode(opts.template, opts.backgroundColor));
  const stylesheets = [
    printCss,
    katexCss,
    themeVariables(opts),
    buildPrintCss(opts),
    codeCss,
  ];
  const service = new PaginationService();
  // Chapter breaks, then the empty-page pass: a break is only worth inserting
  // if the page it opens actually holds something. See `emptyPageBreaks.ts`.
  const pass = await paginateAvoidingEmptyPages(
    paginated,
    opts.chapterLevels ?? [],
    opts.chapterMinLines ?? DEFAULT_CHAPTER_MIN_LINES,
    (stamped) => service.paginate(stamped, stylesheets),
    (result) => result.pages,
  );
  const result = pass.result;

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
      dynamicCss: `${buildPrintCss(opts)}\n${katexCss}\n${codeCss}`,
      pagedCss: collectPagedStyles(),
      rootVarsCss: collectRootVariables(),
      pageCount: result.pageCount,
      pagesMarkup: container.innerHTML,
    });

    return {
      pageCount: result.pageCount,
      chapterBreaksDropped: pass.dropped.length,
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
