import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Cap for captured/edited cover images; PNG is used so quality stays at 100%. */
const COVER_TARGET_WIDTH = 1240;

export function registerFsIpc() {
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
}
