import { app, BrowserWindow, protocol, session } from "electron";
import path from "node:path";
import { DbWorkerClient } from "./db/client.ts";
import { registerAiIpc } from "./ipc/ai.ts";
import { registerCoverProtocol, registerCoversIpc } from "./ipc/covers.ts";
import { registerDbIpc } from "./ipc/db.ts";
import { registerFsIpc } from "./ipc/fs.ts";
import { registerOcrIpc, terminateOcrWorker } from "./ipc/ocr.ts";
import { registerPdfExportIpc } from "./ipc/pdfExport.ts";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "readlynx-cover",
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
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback((permission as string) === "font-access");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return (permission as string) === "font-access";
  });
  const dbPath = path.join(app.getPath("userData"), "readlynx.db");
  dbClient = new DbWorkerClient(dbPath);
  registerDbIpc(dbClient);
  registerFsIpc();
  registerOcrIpc();
  registerAiIpc();
  registerPdfExportIpc();
  registerCoversIpc();
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
