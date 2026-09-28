import { PAGE_MARGIN_MM } from "../../shared/document/pageGeometry";
import type { PageMargins } from "../../shared/document/pageGeometry";
import { scaleHtmlFontSizes, scaledBaseFontSize } from "./fontScale";
import { katexCssForExport } from "./katexExportCss";
import type { ExportThemeOptions } from "./exportTheme";

/**
 * Standalone HTML document assembly, shared by every export source.
 *
 * Source-agnostic on purpose: it takes the semantic HTML body fragment the
 * caller already produced (from the Lexical editor, or from a translated
 * book) and wraps it in a printable document with the export theme applied.
 * Nothing here knows where the content came from.
 */

/** Escapes a value for interpolation into markup. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Page-size `dir`-safe margins, defaulting to the shared page margin. */
function resolveMargins(options: ExportThemeOptions): PageMargins {
  return options.margins ?? {
    top: PAGE_MARGIN_MM,
    right: PAGE_MARGIN_MM,
    bottom: PAGE_MARGIN_MM,
    left: PAGE_MARGIN_MM,
  };
}

/** A full-page cover block that always ends with a page break. */
function coverBlock(coverImage: string, margins: PageMargins): string {
  return `<div style="display:flex;align-items:center;justify-content:center;overflow:hidden;width:100vw;height:100vh;margin:-${margins.top}mm -${margins.right}mm -${margins.bottom}mm -${margins.left}mm;page-break-after:always;"><img src="${escapeHtml(coverImage)}" style="width:100%;height:100%;object-fit:cover;" /></div>`;
}

/**
 * Assembles a complete standalone HTML document around a body fragment with
 * only the given CSS. Used as the base for the paginated PDF document before
 * Paged.js runs, and anywhere a bare wrapper is needed.
 */
export function toDocumentHtml(
  bodyHtml: string,
  options: {
    /** Document title used for `<title>`. */
    title?: string;
    /** CSS text placed in `<head>` before pagination runs. */
    styles?: string;
    /** `@page` rule text (size + margins) for non-paged consumers. */
    pageRule?: string;
  } = {},
): string {
  const { title = "Document", styles = "", pageRule = "" } = options;
  const pageStyle = pageRule ? `\n${pageRule}\n` : "";
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

/**
 * Wraps a body fragment into a standalone HTML document with the export theme
 * applied. Used for the plain HTML export and as the preview of the
 * DOCX/HTML tabs.
 */
export function buildHtmlDocument(
  bodyHtml: string,
  options: ExportThemeOptions = {},
  coverImage?: string,
  title = "Document",
): string {
  const body = scaleHtmlFontSizes(bodyHtml, options.fontSizeScalePct);
  const margins = resolveMargins(options);
  const baseFontSize = scaledBaseFontSize(options.fontSizeScalePct, 16);
  const coverDiv = coverImage ? coverBlock(coverImage, margins) : "";

  const bodyProps = [
    "margin: 0 auto",
    "max-width: 46em",
    "line-height: 1.6",
    `padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
    ...(options.fontFamily ? [`font-family: ${options.fontFamily}`] : []),
    ...(baseFontSize ? [`font-size: ${baseFontSize}`] : []),
    ...(options.textColor ? [`color: ${options.textColor}`] : []),
    ...(options.backgroundColor ? [`background-color: ${options.backgroundColor}`] : []),
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
  body { ${bodyProps}; }
    </style>
    <style>
  ${katexCssForExport()}
    </style>
    <style>
  /* Mermaid diagrams arrive as pre-rendered pictures. */
  figure.rl-diagram { margin: 1.2em 0; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  figure.rl-diagram img { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
    ${coverDiv}${body}
  </body>
</html>`;
}
