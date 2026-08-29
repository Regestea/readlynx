import { app, BrowserWindow, ipcMain, protocol, session } from "electron";
import path from "node:path";
import { DbWorkerClient } from "./db/client.ts";
import { registerAiIpc } from "./ipc/ai.ts";
import { registerBackupIpc } from "./ipc/backup.ts";
import { registerCoverProtocol, registerCoversIpc } from "./ipc/covers.ts";
import { registerTranslationImageProtocol, registerTranslationImagesIpc } from "./ipc/translationImages.ts";
import { registerDbIpc } from "./ipc/db.ts";
import { registerFsIpc } from "./ipc/fs.ts";
import { registerOcrIpc, terminateOcrWorker } from "./ipc/ocr.ts";
import { registerPdfExportIpc } from "./ipc/pdfExport.ts";
import { registerSystemFontsIpc } from "./ipc/systemFonts.ts";
import { getStore } from "./store/storage.ts";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "readlynx-cover",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: "readlynx-translation-image",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: "ReadLynx",
    icon: path.join(import.meta.dirname, "../src/assets/icon/app-icon.png"),
    backgroundColor: "#f7f2ea",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "preload.cjs"),
      spellcheck: false,
      backgroundThrottling: false,
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  /** Closing hands the renderer a chance to finish pending saves first (the
   *  same flush the top-bar back button performs). If the renderer does not
   *  confirm within a few seconds — e.g. it crashed — the window still
   *  closes so the app never hangs on quit. */
  let closeConfirmed = false;
  let closeWaitTimer: ReturnType<typeof setTimeout> | null = null;
  win.on("close", (event) => {
    if (closeConfirmed) return;
    event.preventDefault();
    if (closeWaitTimer !== null) return;
    const onReady = () => {
      closeConfirmed = true;
      closeWaitTimer = null;
      ipcMain.removeListener("app:ready-to-close", onReady);
      win.close();
    };
    closeWaitTimer = setTimeout(onReady, 3000);
    ipcMain.on("app:ready-to-close", onReady);
    win.webContents.send("app:prepare-close");
  });

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
  }
}

let dbClient: DbWorkerClient | null = null;
let dbPath = "";
let storeRoot = "";

/** Starts (or restarts, after a restore swapped the database file) the DB
 *  worker and its IPC handlers. */
function openDb() {
  dbClient = new DbWorkerClient(dbPath, storeRoot);
  registerDbIpc(dbClient);
}

/** Stops the DB worker and unregisters its IPC handlers, so the database
 *  file can be replaced safely. */
function closeDb() {
  dbClient?.close();
  dbClient = null;
}

app.whenReady().then(() => {
  // Initialize the file store singleton
  const store = getStore();

  registerCoverProtocol({ getStore });
  registerTranslationImageProtocol({ getStore });
  registerTranslationImagesIpc({ getStore });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback((permission as string) === "font-access");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return (permission as string) === "font-access";
  });
  dbPath = path.join(app.getPath("userData"), "readlynx.db");
  storeRoot = store.rootPath;
  openDb();
  registerFsIpc({ getStore });
  registerOcrIpc({ getStore });
  registerAiIpc();
  registerSystemFontsIpc();
  registerPdfExportIpc({ getStore });
  registerCoversIpc({ getStore });
  registerBackupIpc({
    dbPath: () => dbPath,
    getClient: () => dbClient,
    closeDb,
    openDb,
    getStore,
  });
  createWindow();
});

app.on("before-quit", () => {
  dbClient?.close();
  dbClient = null;
  void terminateOcrWorker();
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
