import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type { FileStore } from "../store/FileStore.ts";
import type { CleanupEventType } from "../../src/infrastructure/db/entities/types.ts";

/** Upper bound for an "Open with" file (2 GiB). Anything larger is rejected
 *  before hashing so a stray huge file can't stall the app or the store. */
const MAX_OPEN_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** True for paths Electron may hand us that are not real book files
 *  (the exe itself on Windows launches, dev flags, …). */
function looksLikeBookFile(filePath: string): boolean {
  return /\.(pdf|epub|md|markdown)$/i.test(filePath);
}

/** Cap for captured/edited cover images; PNG is used so quality stays at 100%. */
const COVER_TARGET_WIDTH = 1240;

interface FsIpcDeps {
  getStore: () => FileStore;
  /** Records a cleanup-journal event through the db worker. Importing
   *  journals the copy BEFORE writing it, so a crash can only leave the
   *  event behind (replayed), never an untracked orphan file. */
  emitCleanupEvent: (type: CleanupEventType, event: unknown) => Promise<unknown>;
}

export function registerFsIpc({ getStore, emitCleanupEvent }: FsIpcDeps) {
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
   *  bucket-relative key (e.g. `"books/<uuid>.pdf"`), or null on error. The
   *  copy is journaled as an unclaimed `source-imported` event BEFORE the
   *  file is written: the create-book handlers claim the event in the same
   *  transaction as the row insert, and a replay deletes any copy whose
   *  create never happened — so no import can leave an orphan behind. */
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
      if (sourceData.byteLength <= 0) return null;
      const key = `${randomUUID()}${extension}`;
      const storedPath = `books/${key}`;
      // Event first, committed before the file lands.
      await emitCleanupEvent("source-imported", { key: storedPath });
      const store = getStore();
      store.put("books", key, sourceData);
      return storedPath;
    } catch {
      return null;
    }
  });

  /** Content identity of an outside file for library dedupe: byte size plus
   *  a streaming sha256 (never loads the whole file into memory). Returns
   *  null for missing/oversized/non-book files. */
  ipcMain.handle("fs:file-identity", async (_event, sourcePath: string) => {
    try {
      if (!looksLikeBookFile(sourcePath)) return null;
      const fs = await import("node:fs");
      const { createHash } = await import("node:crypto");
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_OPEN_FILE_BYTES) return null;
      const hash = createHash("sha256");
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(sourcePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve());
        stream.on("error", (error) => reject(error));
      });
      return { fileSize: stat.size, fileHash: hash.digest("hex") };
    } catch {
      return null;
    }
  });

  /** Overwrites an already-imported store copy (`books/<uuid>.ext`) with the
   *  current bytes of an outside file — used when the user edited the file
   *  and reopened it. Only touches keys inside the books bucket. */
  ipcMain.handle(
    "fs:replace-source",
    async (_event, options: { storedPath: string; sourcePath: string }) => {
      try {
        if (!options.storedPath.startsWith("books/")) return false;
        const fileName = options.storedPath.slice("books/".length);
        const fs = await import("node:fs/promises");
        const sourceData = await fs.readFile(options.sourcePath);
        if (sourceData.byteLength <= 0 || sourceData.byteLength > MAX_OPEN_FILE_BYTES) return false;
        const store = getStore();
        store.put("books", fileName, sourceData);
        return true;
      } catch {
        return false;
      }
    },
  );

  /** Deletes an already-imported store copy (`books/<uuid>.ext`) that never
   *  got its book row — the cleanup for a failed `create-reading-book` after
   *  a successful `fs:import-source`, so a rejected import leaves no orphan
   *  file in the store. Only touches keys inside the books bucket. */
  ipcMain.handle("fs:delete-stored-source", async (_event, storedPath: string) => {
    try {
      if (typeof storedPath !== "string") return false;
      if (!storedPath.startsWith("books/")) return false;
      const fileName = storedPath.slice("books/".length);
      if (!fileName || fileName.includes("/") || fileName.includes("\\")) return false;
      const store = getStore();
      store.delete("books", fileName);
      return true;
    } catch {
      return false;
    }
  });
}
