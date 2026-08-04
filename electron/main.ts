import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DbWorkerClient } from "./db/client.ts";
import { resolveCoverUrl } from "./db/covers.ts";
import type { SaveDocumentPayload } from "../src/db/entities/types.ts";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "readlynx-cover",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const COVER_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/** Serves cover image files referenced by relative paths in the database. */
function registerCoverProtocol() {
  protocol.handle("readlynx-cover", async (request) => {
    try {
      const dbPath = path.join(app.getPath("userData"), "readlynx.db");
      const filePath = resolveCoverUrl(dbPath, request.url);
      if (!filePath) {
        return new Response("Forbidden", { status: 403 });
      }
      const data = await fs.promises.readFile(filePath);
      const type = COVER_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
      return new Response(data, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

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

function registerIpc(db: DbWorkerClient) {
  ipcMain.handle("db:create-book", () => db.createBook());

  ipcMain.handle("db:save-document", (_event, payload: SaveDocumentPayload) =>
    db.saveDocument(payload),
  );

  ipcMain.handle("db:list-books", () => db.listBooks());

  ipcMain.handle("db:get-book", (_event, bookId: string) => db.getBook(bookId));

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
    try {
      pdfWin.webContents.on("console-message", (event) => {
        console.log(`[pdf-renderer] ${event.level}: ${event.message}`);
      });
      await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(options.html)}`);
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
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: "ReadLynx",
    backgroundColor: "#f7f2ea",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
  }
}

let dbClient: DbWorkerClient | null = null;

app.whenReady().then(() => {
  registerCoverProtocol();
  const dbPath = path.join(app.getPath("userData"), "readlynx.db");
  dbClient = new DbWorkerClient(dbPath);
  registerIpc(dbClient);
  createWindow();
});

app.on("before-quit", () => {
  dbClient?.close();
  dbClient = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
