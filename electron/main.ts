import { app, BrowserWindow, dialog, ipcMain, protocol, session } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Tesseract from "tesseract.js";
import { DbWorkerClient } from "./db/client.ts";
import { resolveCoverUrl } from "./db/covers.ts";
import {
  chatCompletion,
  listGeminiModels,
  structuredCompletion,
  testConnection,
} from "./ai.ts";
import type {
  AiChatMessage,
  AiConnectionInput,
  AiStructuredOptions,
} from "./ai.ts";
import type { AiModel } from "../src/db/entities/AiModel.ts";
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

/** Cap for captured/edited cover images; PNG is used so quality stays at 100%. */
const COVER_TARGET_WIDTH = 1240;

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
  ipcMain.handle("fs:read-bytes", async (_event, filePath: string) => {
    try {
      const data = await fs.promises.readFile(filePath);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } catch {
      return null;
    }
  });

  ipcMain.handle("fs:pick-file", async (event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Open file",
      properties: ["openFile"],
      filters: options?.filters,
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle("fs:capture-rect", async (event, rect: { x: number; y: number; width: number; height: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    try {
      const image = await win.webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      if (image.isEmpty()) return null;
      const size = image.getSize();
      const resized = size.width > COVER_TARGET_WIDTH ? image.resize({ width: COVER_TARGET_WIDTH }) : image;
      return `data:image/png;base64,${resized.toPNG().toString("base64")}`;
    } catch {
      return null;
    }
  });

/** Copies the chosen PDF/EPUB into the app's books directory (next to the
 *  database) and returns the new path, or null when the file is missing. */
  ipcMain.handle("fs:import-source", async (_event, options: { sourcePath: string; sourceType: string }) => {
    try {
      const extension =
        options.sourceType === "pdf"
          ? ".pdf"
          : options.sourceType === "epub"
            ? ".epub"
            : null;
      if (!extension) return null;
      const dir = path.join(app.getPath("userData"), "books");
      await fs.promises.mkdir(dir, { recursive: true });
      const dest = path.join(dir, `${randomUUID()}${extension}`);
      await fs.promises.copyFile(options.sourcePath, dest);
      return dest;
    } catch {
      return null;
    }
  });

  /* ---------- OCR (tesseract.js) ---------- */

  const tessdataDir = (): string => path.join(app.getPath("userData"), "tessdata");

  ipcMain.handle("ocr:get-info", async () => {
    const dir = tessdataDir();
    await fs.promises.mkdir(dir, { recursive: true });
    let files: string[] = [];
    try {
      files = await fs.promises.readdir(dir);
    } catch {
      // treat an unreadable directory as `no models installed`
    }
    const installed = files
      .filter((file) => /\.traineddata(\.gz)?$/.test(file))
      .map((file) => file.replace(/\.traineddata(\.gz)?$/, ""))
      .sort();
    return { dir, installed };
  });

  ipcMain.handle(
    "ocr:download-model",
    async (
      event,
      lang: string,
    ): Promise<{ ok: boolean; lang: string; bytes?: number; error?: string }> => {
      const dir = tessdataDir();
      await fs.promises.mkdir(dir, { recursive: true });
      const url = (model: string) =>
        `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/${model}/${lang}.traineddata.gz`;
      const dest = path.join(dir, `${lang}.traineddata.gz`);
      try {
        // Prefer the higher-quality best_int models; fall back to the
        // standard 4.0.0 data for languages that don't ship them.
        let resp = await fetch(url("4.0.0_best_int"));
        if (!resp.ok) resp = await fetch(url("4.0.0"));
        if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
        const total = Number(resp.headers.get("content-length")) || 0;
        if (!resp.body) throw new Error("Response body is empty");
        const reader = resp.body.getReader();
        const out = await fs.promises.open(dest, "w");
        let received = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            await out.write(value);
            if (total > 0 && !event.sender.isDestroyed()) {
              event.sender.send("ocr:download-progress", { lang, received, total });
            }
          }
        } finally {
          await out.close();
        }
        return { ok: true, lang, bytes: received };
      } catch (err) {
        await fs.promises.unlink(dest).catch(() => undefined);
        return { ok: false, lang, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("ocr:delete-model", async (_event, lang: string) => {
    const dest = path.join(tessdataDir(), `${lang}.traineddata.gz`);
    try {
      await fs.promises.unlink(dest);
      return { ok: true, lang };
    } catch {
      return { ok: false, lang };
    }
  });

  ipcMain.handle(
    "ocr:recognize",
    async (
      event,
      payload: { dataUrl: string; langs: string[] },
    ): Promise<{ text?: string; error?: string }> => {
      const { dataUrl, langs } = payload;
      const langsKey = Array.from(new Set(langs.filter(Boolean))).join("+");
      if (!langsKey) return { error: "Select at least one language." };
      const dir = tessdataDir();
      await fs.promises.mkdir(dir, { recursive: true });
      for (const lang of langsKey.split("+")) {
        const exists = await fs.promises
          .access(path.join(dir, `${lang}.traineddata.gz`))
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          return { error: `The "${lang}" model is not downloaded yet. Download it from the OCR panel first.` };
        }
      }
      const sendProgress = (progress: number) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("ocr:recognize-progress", { progress });
        }
      };
      try {
        sendProgress(0);
        if (!ocrWorker) {
          ocrWorker = await Tesseract.createWorker(langsKey, Tesseract.OEM.LSTM_ONLY, {
            langPath: dir,
            gzip: true,
            cacheMethod: "none",
            cachePath: dir,
            logger: (message) => {
              if (message.status === "recognizing text") sendProgress(message.progress);
            },
          });
          ocrWorkerLangs = langsKey;
        } else if (ocrWorkerLangs !== langsKey) {
          await ocrWorker.reinitialize(langsKey, Tesseract.OEM.LSTM_ONLY);
          ocrWorkerLangs = langsKey;
        }
        const { data } = await ocrWorker.recognize(dataUrl);
        sendProgress(1);
        return { text: data.text };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("db:create-book", () => db.createBook());

  ipcMain.handle("db:create-translated-book", (_event, payload) =>
    db.createTranslatedBook(payload),
  );

  ipcMain.handle("db:save-document", (_event, payload: SaveDocumentPayload) =>
    db.saveDocument(payload),
  );

  ipcMain.handle("db:list-books", () => db.listBooks());

  ipcMain.handle("db:get-book", (_event, bookId: string) => db.getBook(bookId));

  ipcMain.handle("db:delete-book", (_event, bookId: string) => db.deleteBook(bookId));

  ipcMain.handle("cover:read-data-url", async (_event, relativePath: string) => {
    try {
      const dbPath = path.join(app.getPath("userData"), "readlynx.db");
      const root = path.resolve(path.dirname(dbPath), "covers");
      const rel = relativePath.replace(/^covers\//, "");
      const filePath = path.resolve(root, rel);
      if (!filePath.startsWith(root + path.sep)) return null;
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = COVER_MIME_TYPES[ext] ?? "application/octet-stream";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle("db:get-app-settings", () => db.getAppSettings());

  ipcMain.handle("db:update-app-settings", (_event, theme: string) => db.updateAppSettings(theme));

  ipcMain.handle("db:ai-models-list", () => db.listAiModels());

  ipcMain.handle("db:ai-model-create", (_event, model: AiModel) => db.createAiModel(model));

  ipcMain.handle("db:ai-model-update", (_event, model: AiModel) => db.updateAiModel(model));

  ipcMain.handle("db:ai-model-delete", (_event, id: string) => db.deleteAiModel(id));

  /* ---------- AI (native requests, no CORS) ---------- */

  ipcMain.handle("ai:test", (_event, input: AiConnectionInput) => testConnection(input));

  ipcMain.handle("ai:list-gemini-models", (_event, apiKey: string) =>
    listGeminiModels(apiKey),
  );

  ipcMain.handle(
    "ai:chat",
    (_event, payload: { input: AiConnectionInput; messages: AiChatMessage[] }) =>
      chatCompletion(payload.input, payload.messages),
  );

  ipcMain.handle(
    "ai:structured",
    (_event, payload: { input: AiConnectionInput; options: AiStructuredOptions }) =>
      structuredCompletion(payload.input, payload.options),
  );

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

/** Lazily-created tesseract worker shared across OCR requests. */
let ocrWorker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;
let ocrWorkerLangs = "";

app.whenReady().then(() => {
  registerCoverProtocol();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback((permission as string) === "font-access");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return (permission as string) === "font-access";
  });
  const dbPath = path.join(app.getPath("userData"), "readlynx.db");
  dbClient = new DbWorkerClient(dbPath);
  registerIpc(dbClient);
  createWindow();
});

app.on("before-quit", () => {
  dbClient?.close();
  dbClient = null;
  void ocrWorker?.terminate();
  ocrWorker = null;
  ocrWorkerLangs = "";
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
