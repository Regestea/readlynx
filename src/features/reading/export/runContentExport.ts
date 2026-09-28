import { buildPdfDocument } from "../../../infrastructure/export/pdfExporter";
import { buildHtmlDocument } from "../../../infrastructure/export/htmlDocument";
import { buildDocxFromHtml } from "../../../infrastructure/export/docxWriter";
import { buildEpubFiles, zipEpubFiles } from "../../../infrastructure/export/epubWriter";
import type { ExportContent, ExportSettings } from "../../../components/export/types";

/**
 * Writes an `ExportContent` out in the format the user picked. Shared by every
 * export host so the PDF path (Electron `printToPDF` with a browser-print
 * fallback) and the plain-download path behave identically wherever the
 * dialog is opened from.
 */

/** Saves a string as a file download. */
export function downloadTextFile(name: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  triggerDownload(url, name);
}

/** Saves a blob as a file download. */
export function downloadBlobFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
}

function triggerDownload(url: string, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The export theme a `ExportSettings` describes. */
function themeFor(settings: ExportSettings) {
  return {
    textColor: settings.textColor,
    backgroundColor: settings.backgroundColor,
    fontSizeScalePct: settings.fontSizeScalePct,
    fontFamily: settings.fontFamily,
    margins: {
      top: settings.marginTopMm,
      right: settings.marginRightMm,
      bottom: settings.marginBottomMm,
      left: settings.marginLeftMm,
    },
    template: settings.template,
    codeTheme: settings.codeTheme,
    codeFontFamily: settings.codeFontFamily,
  };
}

/** The PDF page geometry a `ExportSettings` describes. */
function pdfOptions(settings: ExportSettings) {
  return {
    pageFormat: settings.pageFormat,
    margins: {
      top: settings.marginTopMm,
      right: settings.marginRightMm,
      bottom: settings.marginBottomMm,
      left: settings.marginLeftMm,
    },
    fontSizeScalePct: settings.fontSizeScalePct,
    fontFamily: settings.fontFamily,
    textColor: settings.textColor,
    backgroundColor: settings.backgroundColor,
    showPageNumbers: settings.showPageNumbers,
    chapterLevels: settings.chapterLevels,
    chapterMinLines: settings.chapterMinLines,
    inlineImages: true,
    template: settings.template,
    codeTheme: settings.codeTheme,
    codeFontFamily: settings.codeFontFamily,
  };
}

/** Runs the chosen export. `fileBase` is the name without extension. */
export async function runContentExport(
  content: ExportContent,
  settings: ExportSettings,
  fileBase: string,
): Promise<void> {
  // HTML, DOCX and EPUB are flowing formats, so they get the body as-is. The
  // paged PDF path stamps and measures its own chapter breaks, because that
  // needs the paginator.
  const bodyHtml = content.bodyHtml();

  if (settings.format === "html") {
    downloadTextFile(
      `${fileBase}.html`,
      buildHtmlDocument(bodyHtml, themeFor(settings), undefined, content.label),
      "text/html;charset=utf-8",
    );
    return;
  }
  if (settings.format === "docx") {
    downloadBlobFile(
      `${fileBase}.docx`,
      await buildDocxFromHtml(bodyHtml, settings.pageFormat, themeFor(settings)),
    );
    return;
  }
  if (settings.format === "epub") {
    // Prefer the source's own EPUB builder when it has one: it can embed the
    // original images, which a re-parse of the body HTML cannot. This is also
    // the path the dialog previewed, so preview and download agree.
    const theme = themeFor(settings);
    const own = content.epub ? await content.epub(theme, undefined) : null;
    const built: Blob = own
      ? new Blob([own], { type: "application/epub+zip" })
      : zipEpubFiles(buildEpubFiles(bodyHtml, { title: content.label }, theme));
    downloadBlobFile(`${fileBase}.epub`, built);
    return;
  }
  if (settings.format !== "pdf") return;

  const { html } = await buildPdfDocument(bodyHtml, pdfOptions(settings));
  if (window.readlynx?.exportPdf) {
    await window.readlynx.exportPdf({ defaultPath: `${fileBase}.pdf`, html });
    return;
  }
  // No print bridge in this host: paginate in a hidden frame and let the
  // browser's own print dialog handle it.
  printHtml(html);
}

/** Opens the browser print dialog on a standalone paginated document. */
function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    frame.remove();
  };
  window.addEventListener("afterprint", cleanup);
  const doc = frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
  }
  // Give the frame a tick to lay out before the modal print dialog opens.
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }, 100);
}
