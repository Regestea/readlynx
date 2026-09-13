import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type { FileStore } from "../store/FileStore.ts";

/** Cap for captured/edited cover images; PNG is used so quality stays at 100%. */
const COVER_TARGET_WIDTH = 1240;

interface FsIpcDeps {
  getStore: () => FileStore;
}

export function registerFsIpc({ getStore }: FsIpcDeps) {
  ipcMain.handle("fs:read-bytes", async (_event, filePath: string) => {
    try {
      const store = getStore();
      const fs = await import("node:fs/promises");
      // Try store first (relative key), then fall back to absolute path
      const resolved = filePath.startsWith("books/") || filePath.startsWith("covers/")
        ? store.resolve(filePath)
        : filePath;
      if (!resolved) return null;
      const data = await fs.readFile(resolved);
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

  /** Copies the chosen PDF/EPUB/Markdown into the books bucket and returns the
   *  bucket-relative key (e.g. `"books/<uuid>.pdf"`), or null on error. */
  ipcMain.handle("fs:import-source", async (_event, options: { sourcePath: string; sourceType: string }) => {
    try {
      const extension =
        options.sourceType === "pdf"
          ? ".pdf"
          : options.sourceType === "epub"
            ? ".epub"
            : options.sourceType === "markdown"
              ? ".md"
              : null;
      if (!extension) return null;
      const fs = await import("node:fs/promises");
      const sourceData = await fs.readFile(options.sourcePath);
      const store = getStore();
      const key = `${randomUUID()}${extension}`;
      store.put("books", key, sourceData);
      return `books/${key}`;
    } catch {
      return null;
    }
  });
}
