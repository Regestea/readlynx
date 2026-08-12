import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import { PAGE_FORMATS, uniformMargins } from "../constants";
import type { PageFormat } from "../constants";
import type { ExportThemeOptions } from "../types";
import { scaleHtmlFontSizes, scaledBaseFontSize } from "../../../../infrastructure/export/fontScale";

/** CSS pixels per millimeter at the browser's 96dpi base. */
const PX_PER_MM = 96 / 25.4;

function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

function parseCssSize(cssSize: string): { widthMm: number; heightMm: number } {
  const [w, h] = cssSize.split(/\s+/);
  const toMm = (s: string): number => {
    const m = s.match(/^([\d.]+)(mm|in)$/);
    if (!m) return 0;
    return m[2] === "in" ? parseFloat(m[1]) * 25.4 : parseFloat(m[1]);
  };
  return { widthMm: toMm(w), heightMm: toMm(h) };
}

/** Standalone HTML for the hidden-window PDF renderer.
 *
 *  Chromium never paints the `@page` margin band, so the exported page has
 *  `margin: 0` and is paginated by script into explicit full-bleed `.pdf-page`
 *  divs (page-sized, with the document margin applied as padding and the
 *  background painted edge to edge). The paginator runs in the main process
 *  after fonts/images have loaded; it reads the page geometry from
 *  `#pdf-content[data-paginate]`. */
export function exportPdfHtml(
  editor: LexicalEditor,
  options: ExportThemeOptions = {},
  pageFormat: PageFormat = "a4",
): string {
  const body = scaleHtmlFontSizes(editor.read(() => $generateHtmlFromNodes(editor)), options.fontSizeScalePct);

  const { widthMm, heightMm } = parseCssSize(PAGE_FORMATS[pageFormat].cssSize);
  const pageWpx = mmToPx(widthMm);
  const pageHpx = mmToPx(heightMm);
  const margins = options.margins ?? uniformMargins(12.7);
  const baseFontSize = scaledBaseFontSize(options.fontSizeScalePct, 16);

  const rootProps = [
    "margin: 0",
    "padding: 0",
    "-webkit-print-color-adjust: exact",
    "print-color-adjust: exact",
  ].join("; ");

  const bodyProps = [
    "margin: 0",
    "padding: 0",
    "line-height: 1.6",
    "-webkit-print-color-adjust: exact",
    "print-color-adjust: exact",
    ...(options.fontFamily ? [`font-family: ${options.fontFamily}`] : []),
    ...(baseFontSize ? [`font-size: ${baseFontSize}`] : []),
    ...(options.textColor ? [`color: ${options.textColor}`] : []),
  ].join("; ");

  const pageProps = [
    `width: ${pageWpx}px`,
    "box-sizing: border-box",
    `padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
    "break-after: page",
    "page-break-after: always",
    "-webkit-print-color-adjust: exact",
    "print-color-adjust: exact",
    ...(options.backgroundColor ? [`background-color: ${options.backgroundColor}`] : []),
  ].join("; ");

  const paginate = JSON.stringify({ pageHpx, pageWpx });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Document</title>
    <style>
  @page { size: ${PAGE_FORMATS[pageFormat].cssSize}; margin: 0; }
  html { ${rootProps}; }
  body { ${bodyProps}; }
  .pdf-page { ${pageProps}; }
  .pdf-page > :first-child { margin-top: 0; }
  .pdf-page > :last-child { margin-bottom: 0; }
    </style>
  </head>
  <body>
    <div id="pdf-content" data-paginate='${paginate}'>
      ${body}
    </div>
  </body>
</html>`;
}
