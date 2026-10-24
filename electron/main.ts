import { app, BrowserWindow, ipcMain, protocol, session } from "electron";
import { existsSync, writeFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DbWorkerClient } from "./db/client.ts";
import { registerAiIpc } from "./ipc/ai.ts";
import { registerBackupIpc } from "./ipc/backup.ts";
import { registerClipboardIpc } from "./ipc/clipboard.ts";
import { registerCoverProtocol, registerCoversIpc } from "./ipc/covers.ts";
import { registerTranslationImageProtocol, registerTranslationImagesIpc } from "./ipc/translationImages.ts";
import { registerDbIpc } from "./ipc/db.ts";
import { registerFsIpc } from "./ipc/fs.ts";
import { registerOcrIpc, terminateOcrWorker } from "./ipc/ocr.ts";
import { registerPdfExportIpc } from "./ipc/pdfExport.ts";
import { registerSystemFontsIpc } from "./ipc/systemFonts.ts";
import { registerUiScaleIpc, registerWindowIpc, watchWindowState } from "./ipc/window.ts";
import type { WindowContext } from "./ipc/window.ts";
import { registerUpdaterIpc } from "./ipc/updater.ts";
import { getStore } from "./store/storage.ts";
import { pruneUpdateCache } from "./updater.ts";
import { clampUiScale } from "../src/shared/uiScale.ts";

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

let mainWindow: BrowserWindow | null = null;
/** Book shown by each reader window, keyed by webContents id. Read back by the
 *  renderer's `window:get-context`, which is how a reader window knows to
 *  paint one book instead of the whole shell. */
const readerBooks = new Map<number, string>();
/** A book file handed by the OS before the window/renderer was ready
 *  (cold start via double-click, or macOS `open-file`). Flushed once the
 *  page finishes loading, or pulled by the renderer on mount. */
let pendingOpenFile: string | null = null;

/** Opens `bookId` in its own window, focusing one already showing it instead
 *  of stacking a second copy of the same book. */
function openReaderWindow(bookId: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (readerBooks.get(win.webContents.id) !== bookId) continue;
    if (win.isMinimized()) win.restore();
    win.focus();
    return;
  }
  createWindow("reader", bookId);
}

/** True for OS-provided paths that are actual book files (filters out the
 *  exe path itself, dev flags, …). Mirrors the main-side check in
 *  `ipc/fs.ts` so both layers agree. */
function findBookFile(argv: string[]): string | null {
  const found = argv.find((arg) => /\.(pdf|epub|md|markdown)$/i.test(arg));
  return found ?? null;
}

/** Routes an OS-opened book file to the window, queuing it when the
 *  renderer is not ready yet. */
function deliverOpenFile(filePath: string) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send("app:open-file", filePath);
  } else {
    pendingOpenFile = filePath;
  }
}

// macOS delivers double-clicked files here — even before `ready`.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (/\.(pdf|epub|md|markdown)$/i.test(filePath)) deliverOpenFile(filePath);
});

// Windows/Linux deliver them to the second instance's argv.
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const filePath = findBookFile(argv);
    if (filePath) deliverOpenFile(filePath);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/** Profile marker recording that this machine last ran without GPU
 *  acceleration and should keep doing so — see the fallback below. Deleting
 *  the file (or fixing the drivers) restores hardware acceleration. */
const gpuFallbackMarker = path.join(app.getPath("userData"), "gpu-fallback");

// Hardware-acceleration fallback: on machines where the compositor cannot
// bring up a GPU process at all (VMs, WSL, remote sessions, missing or
// blocklisted drivers) Chromium keeps retrying the launch while the renderer
// loses its compositor — the window dies and the app quits, which from the
// outside reads as "installed but never opens". The first session that sees
// repeated GPU-process failures writes the marker and relaunches once; every
// later start calls `disableHardwareAcceleration()` before ready, so Chromium
// composites in software (SwiftShader) instead — for a document reader that
// is indistinguishable. A single failure is tolerated (Chromium also restarts
// a healthy GPU process for power management with reasons like "killed" or
// "clean-exit", which are not counted); only "crashed" / "launch-failed"
// twice in one session trips the fallback.
const gpuFallbackActive =
  existsSync(gpuFallbackMarker) || process.argv.includes("--disable-gpu");
if (gpuFallbackActive) app.disableHardwareAcceleration();

let gpuProcessFailures = 0;
app.on("child-process-gone", (_event, details) => {
  if (gpuFallbackActive || details.type !== "GPU") return;
  if (details.reason !== "crashed" && details.reason !== "launch-failed") return;
  gpuProcessFailures += 1;
  if (gpuProcessFailures < 2) return;
  try {
    writeFileSync(gpuFallbackMarker, "");
  } catch {
    // A profile that cannot be written just means the next launch retries
    // with the GPU enabled.
  }
  console.error("[gpu] hardware acceleration unavailable — restarting in software rendering mode");
  app.relaunch();
  // `quit` (not `exit`) so `before-quit` still flushes the DB worker.
  app.quit();
});

async function createWindow(role: WindowContext["role"] = "main", bookId: string | null = null) {
  const win = new BrowserWindow({
    width: role === "reader" ? 1080 : 1440,
    height: role === "reader" ? 860 : 900,
    // Sized so two windows sit side by side on a 1440-wide screen (720 each).
    // The shell has no width floor of its own — the home view drops its stats
    // panel below 1120px (`App.module.css`), so the shelf keeps the space —
    // and a reading window fills everything except the collapsed sidebar.
    minWidth: role === "reader" ? 480 : 700,
    minHeight: role === "reader" ? 420 : 560,
    title: "ReadLynx",
    icon: path.join(import.meta.dirname, "../src/assets/icon/app-icon.png"),
    backgroundColor: "#f7f2ea",
    autoHideMenuBar: true,
    // Removes the OS caption so the app can draw its own slim title bar (see
    // `src/app/layout/TitleBar`). The frame, resize border, drop shadow and
    // rounded corners stay native: unlike `frame: false`, only the title bar
    // is gone. `titleBarOverlay` is deliberately left off, which is what hides
    // the native minimize/maximize/close buttons on Windows and Linux — the
    // renderer draws those instead.
    titleBarStyle: "hidden",
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "preload.cjs"),
      spellcheck: false,
      backgroundThrottling: false,
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
    },
  });

  // The custom title bar replaces the traffic lights on macOS too, so they
  // would otherwise sit on top of it.
  if (process.platform === "darwin") {
    win.setWindowButtonVisibility(false);
  }

  watchWindowState(win);

  win.once("ready-to-show", () => {
    win.show();
  });

  if (role === "reader" && bookId) {
    // Registered before the renderer can ask what it is: the renderer pulls
    // its context on mount, and a reader window would otherwise paint the
    // whole shell for one frame before learning it is a reader.
    readerBooks.set(win.webContents.id, bookId);
  }
  win.webContents.once("destroyed", () => {
    readerBooks.delete(win.webContents.id);
  });

  if (role === "main") mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // A cold-start file (double-click while the app was closed) is delivered
  // once the renderer can receive it.
  win.webContents.on("did-finish-load", () => {
    if (pendingOpenFile) {
      const filePath = pendingOpenFile;
      pendingOpenFile = null;
      win.webContents.send("app:open-file", filePath);
    }
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
    /** Runs on the renderer's confirmation and on the timeout alike, so it has
     *  to be idempotent: the timer is *not* cleared anywhere else, and a
     *  still-pending one would fire a second time on an already closed window
     *  ("Object has been destroyed"). That only surfaced with a second window,
     *  because closing the last one quits the process before the timer is
     *  ever reached. */
    const onReady = (readyEvent?: Electron.IpcMainEvent) => {
      // `ipcMain` is shared by every window, so another window announcing it
      // is done must not close this one.
      if (readyEvent && readyEvent.sender !== win.webContents) return;
      if (closeConfirmed) return;
      closeConfirmed = true;
      if (closeWaitTimer !== null) {
        clearTimeout(closeWaitTimer);
        closeWaitTimer = null;
      }
      ipcMain.removeListener("app:ready-to-close", onReady);
      if (!win.isDestroyed()) win.close();
    };
    closeWaitTimer = setTimeout(onReady, 3000);
    ipcMain.on("app:ready-to-close", onReady);
    win.webContents.send("app:prepare-close");
  });

  // One stored interface scale for every window: the shell and its readers
  // must not diverge. Applied before the first paint the page can produce, so
  // opening with a changed scale never flashes at 100%. A DB hiccup falls
  // back to unscaled (the clamp returns the default for non-finite values).
  const storedScale = await dbClient
    ?.getAppSettings()
    .then((settings) => settings?.uiScale)
    .catch(() => undefined);
  win.webContents.setZoomFactor(clampUiScale(storedScale) / 100);

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
 *  file can be replaced safely. Awaited so the SQLite handle is really
 *  released before the file is swapped. */
async function closeDb() {
  const client = dbClient;
  dbClient = null;
  if (client) await client.close();
}

/** Hicolor sizes and MIME-derived icon names — kept in sync with the PNGs
 *  under `src/assets/icon/mime` and the deb `fpm` mappings in
 *  electron-builder.yml. */
const mimeIconSizes = [128, 256, 512] as const;
const mimeIconNames = ["application-pdf", "application-epub+zip", "text-markdown"] as const;

/** Installing the per-file-type icons for AppImage builds. A file manager
 *  resolves MIME icons from the host's own icon dirs, never from inside the
 *  mounted image — and, unlike the deb, nothing ships them system-wide — so
 *  the app mirrors the same assets into the user's hicolor tree. Idempotent
 *  and best-effort: failures (e.g. a read-only home) must not break startup. */
async function installMimeIcons() {
  const srcDir = path.join(import.meta.dirname, "../src/assets/icon/mime");
  const dataHome = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
  for (const size of mimeIconSizes) {
    const dir = path.join(dataHome, "icons", "hicolor", `${size}x${size}`, "mimetypes");
    for (const name of mimeIconNames) {
      await mkdir(dir, { recursive: true });
      await copyFile(path.join(srcDir, `${name}.${size}.png`), path.join(dir, `${name}.png`));
    }
  }
}

app.whenReady().then(() => {
  // Dev builds only — a packaged mac app gets its dock icon from the .app
  // bundle (set via `mac.icon` in electron-builder.yml).
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(path.join(import.meta.dirname, "../src/assets/icon/app-icon.png"));
  }

  // AppImage only — the deb already installs per-file-type icons system-wide
  // (via `linux.fpm`), and dev runs need no icon registration either.
  if (process.platform === "linux" && process.env.APPIMAGE) {
    void installMimeIcons().catch(() => {});
  }

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
  registerFsIpc({
    getStore,
    emitCleanupEvent: (type, event) => {
      // `dbClient` is swapped by backup/restore; the closure reads whichever
      // worker is live at the moment. No worker → no journal → the import
      // aborts instead of writing an untracked file.
      const client = dbClient;
      if (!client) throw new Error("The database worker is not running.");
      return client.emitCleanupEvent(type, event);
    },
  });
  registerOcrIpc({ getStore });
  registerAiIpc();
  registerSystemFontsIpc();
  registerClipboardIpc();
  registerUpdaterIpc();
  pruneUpdateCache();
  registerWindowIpc({
    mainWindow: () => mainWindow,
    readerBooks,
    openReader: openReaderWindow,
  });
  registerUiScaleIpc();
  registerPdfExportIpc({ getStore });
  registerCoversIpc({ getStore });
  registerBackupIpc({
    dbPath: () => dbPath,
    getClient: () => dbClient,
    closeDb,
    openDb,
    getStore,
  });
  // Renderer pull-model fallback for the cold-start file (covers the case
  // where the push above raced the renderer's listener registration).
  ipcMain.handle("app:get-pending-file", () => {
    const filePath = pendingOpenFile;
    pendingOpenFile = null;
    return filePath;
  });
  // Cold start via file association (Windows/Linux argv; macOS uses
  // `open-file`, queued above).
  const launchFile = findBookFile(process.argv.slice(app.isPackaged ? 1 : 2));
  if (launchFile) pendingOpenFile = launchFile;
  createWindow();
});

app.on("before-quit", () => {
  const client = dbClient;
  dbClient = null;
  if (client) void client.close();
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
