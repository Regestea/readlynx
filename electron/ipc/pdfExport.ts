import { BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

interface ExportPdfOptions {
  defaultPath: string;
  html: string;
}

/** Paginates `#pdf-content` (see `exportPdfHtml`) into explicit full-bleed
 *  `.pdf-page` divs so the background covers the whole sheet and the document
 *  margin survives page breaks. Runs in the hidden PDF renderer after fonts
 *  and images are ready; geometry comes from `data-paginate`. */
const PDF_PAGINATOR_SRC = `(() => {
  const content = document.getElementById("pdf-content");
  if (!content) return;
  const cfg = JSON.parse(content.dataset.paginate || "{}");
  const pageHpx = Number(cfg.pageHpx);
  if (!Number.isFinite(pageHpx) || pageHpx <= 0) return;
  const blocks = Array.from(content.children);
  content.innerHTML = "";
  let page = document.createElement("div");
  page.className = "pdf-page";
  content.appendChild(page);
  for (const block of blocks) {
    page.appendChild(block);
    if (page.scrollHeight > pageHpx) {
      page.removeChild(block);
      page = document.createElement("div");
      page.className = "pdf-page";
      content.appendChild(page);
      page.appendChild(block);
    }
  }
  for (const p of content.querySelectorAll(".pdf-page")) p.style.height = pageHpx + "px";
  const last = content.lastElementChild;
  if (last) last.style.breakAfter = "auto";
})();`;

export function registerPdfExportIpc() {
  ipcMain.handle("export-pdf", async (event, options: ExportPdfOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export PDF",
      defaultPath: options.defaultPath,
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return null;

    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    // Write the export HTML to a temp file rather than a `data:` URL: the
    // whole state is often > 2 MB (fonts/cover images) and Chromium rejects
    // data URLs over that with ERR_INVALID_URL.
    const tempDir = await fs.promises.mkdtemp(path.join(app.getPath("temp"), "readlynx-export-"));
    const htmlPath = path.join(tempDir, "document.html");
    await fs.promises.writeFile(htmlPath, options.html, "utf8");
    try {
      pdfWin.webContents.on("console-message", (event) => {
        console.log(`[pdf-renderer] ${event.level}: ${event.message}`);
      });
      await pdfWin.loadFile(htmlPath);
      await pdfWin.webContents.executeJavaScript(
        `Promise.all([
          document.fonts.ready,
          Promise.all([...document.images].map((img) => img.decode().catch(() => undefined))),
        ])`,
      );
      // Page geometry comes from the HTML (`@page` rule plus script-driven
      // pagination into `.pdf-page` divs); `preferCSSPageSize` keeps Chromium
      // from applying printer defaults.
      await pdfWin.webContents.executeJavaScript(PDF_PAGINATOR_SRC);
      const data = await pdfWin.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      });
      await fs.promises.writeFile(filePath, data);
      return filePath;
    } finally {
      pdfWin.destroy();
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
