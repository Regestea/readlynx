import { BrowserWindow, ipcMain } from "electron";

/** What a window is for. The main window is the shell — sidebar, tabs and
 *  everything else. A reader window shows exactly one book and nothing else,
 *  so a book can be read side by side with the shell without both sharing one
 *  renderer. */
export interface WindowContext {
  role: "main" | "reader";
  bookId: string | null;
}

/** Which window is talking. Resolved per message rather than captured once:
 *  with more than one window open, a captured reference would send the close
 *  button of the reader window to the shell. */
function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Window controls for the custom title bar (`titleBarStyle: "hidden"`), plus
 *  the window context the renderer reads once on mount.
 *
 *  `close` must go through `win.close()`, never `win.destroy()`: `destroy()`
 *  skips the `close` event that `main.ts` uses to hand the renderer a chance
 *  to flush pending saves, so unsaved work would be lost on every quit. */
export function registerWindowIpc(options: {
  /** The shell window. Only it may spawn readers. */
  mainWindow: () => BrowserWindow | null;
  /** Book shown by each reader window, keyed by webContents id. */
  readerBooks: Map<number, string>;
  /** Opens a reader window for a book, or focuses the one already showing it. */
  openReader: (bookId: string) => void;
}) {
  ipcMain.handle("window:get-context", (event): WindowContext => {
    // Anything not registered as a reader is the shell.
    const bookId = options.readerBooks.get(event.sender.id) ?? null;
    return bookId
      ? { role: "reader", bookId }
      : { role: "main", bookId: null };
  });

  ipcMain.handle("window:open-book", (event, bookId: string) => {
    // Only the shell spawns readers: a reader window already has one book, and
    // a second one inside it would just be a tab that cannot be reached.
    if (senderWindow(event) !== options.mainWindow()) return false;
    options.openReader(bookId);
    return true;
  });

  ipcMain.handle("window:minimize", (event) => {
    senderWindow(event)?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = senderWindow(event);
    if (!win || win.isDestroyed()) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle("window:close", (event) => {
    senderWindow(event)?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = senderWindow(event);
    return win && !win.isDestroyed() ? win.isMaximized() : false;
  });
}

/** The renderer paints the maximize/restore glyph, so it has to hear about
 *  state changes the user did not ask for — double-clicking the taskbar icon,
 *  Win+Up, a snapped layout, or the OS restoring a saved size. */
export function watchWindowState(win: BrowserWindow) {
  const send = (maximized: boolean) => {
    if (!win.webContents.isDestroyed()) win.webContents.send("window:maximized-changed", maximized);
  };
  win.on("maximize", () => send(true));
  win.on("unmaximize", () => send(false));
}