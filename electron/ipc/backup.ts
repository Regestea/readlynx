import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import type { DbWorkerClient } from "../db/client.ts";
import { coversDirectory } from "../db/covers.ts";
import { sourcesDirectory } from "../db/sources.ts";

const BACKUP_DB_NAME = "readlynx.db";
const COVERS_PREFIX = "covers/";
const BOOKS_PREFIX = "books/";

/** `readlynx-backup-2026-08-15-1430.zip` — local time, minutes precision. */
function backupStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Reads every regular file of a directory into a `name -> bytes` map,
 *  shallow (the covers directory only holds flat files). */
async function readFilesFlat(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const name of await fs.promises.readdir(dir)) {
    const full = path.join(dir, name);
    const stat = await fs.promises.stat(full);
    if (stat.isFile()) files[name] = await fs.promises.readFile(full);
  }
  return files;
}

/** True when the bytes look like a SQLite database file. */
function isSqlite(data: Uint8Array): boolean {
  return (
    data.length >= 16 &&
    data[0] === 0x53 && // "SQLite format 3\0"
    data[1] === 0x51 &&
    data[2] === 0x4c &&
    data[3] === 0x69 &&
    data[4] === 0x74 &&
    data[5] === 0x65 &&
    data[6] === 0x20 &&
    data[7] === 0x66 &&
    data[8] === 0x6f &&
    data[9] === 0x72 &&
    data[10] === 0x6d &&
    data[11] === 0x61 &&
    data[12] === 0x74 &&
    data[13] === 0x20 &&
    data[14] === 0x33 &&
    data[15] === 0x00
  );
}

export interface BackupIpcDeps {
  /** Absolute path of the live database file. */
  dbPath: () => string;
  /** The current DB worker client, or null while it is stopped. */
  getClient: () => DbWorkerClient | null;
  /** Stops the DB worker and unregisters its IPC handlers. */
  closeDb: () => void;
  /** Starts a fresh DB worker against the (swapped) database file. */
  openDb: () => void;
}

/** Backup = a single zip with the SQLite snapshot (`readlynx.db`, produced by
 *  the worker's backup API so WAL content is included) plus the covers and
 *  book-source directories. Restore = unzip, validate, stop the DB worker,
 *  swap the file and directories, then start the worker again on the restored
 *  database. */
export function registerBackupIpc({ dbPath, getClient, closeDb, openDb }: BackupIpcDeps) {
  ipcMain.handle("backup:create", async (event): Promise<{ ok: boolean; path?: string; error?: string } | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save ReadLynx backup",
      defaultPath: `readlynx-backup-${backupStamp()}.zip`,
      filters: [{ name: "ReadLynx backup", extensions: ["zip"] }],
    });
    if (canceled || !filePath) return null;

    const client = getClient();
    if (!client) return { ok: false, error: "The database is not available." };

    const tempDir = await fs.promises.mkdtemp(
      path.join(app.getPath("temp"), "readlynx-backup-"),
    );
    try {
      const dbFile = path.join(tempDir, BACKUP_DB_NAME);
      await client.createBackup(dbFile);
      const files: Record<string, Uint8Array> = {
        [BACKUP_DB_NAME]: await fs.promises.readFile(dbFile),
      };
      const coversDir = coversDirectory(dbPath());
      if (fs.existsSync(coversDir)) {
        for (const [name, bytes] of Object.entries(await readFilesFlat(coversDir))) {
          files[`${COVERS_PREFIX}${name}`] = bytes;
        }
      }
      const booksDir = sourcesDirectory(dbPath());
      if (fs.existsSync(booksDir)) {
        for (const [name, bytes] of Object.entries(await readFilesFlat(booksDir))) {
          files[`${BOOKS_PREFIX}${name}`] = bytes;
        }
      }
      const zipped = zipSync(files, { level: 6 });
      await fs.promises.writeFile(
        filePath,
        Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength),
      );
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  ipcMain.handle("backup:restore", async (event): Promise<{ ok: boolean; path?: string; error?: string } | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Restore ReadLynx backup",
      properties: ["openFile"],
      filters: [{ name: "ReadLynx backup", extensions: ["zip"] }],
    });
    if (canceled || filePaths.length === 0) return null;
    const zipPath = filePaths[0];

    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(await fs.promises.readFile(zipPath));
    } catch {
      return { ok: false, error: "The selected file is not a valid ReadLynx backup." };
    }
    const dbEntry = files[BACKUP_DB_NAME];
    if (!dbEntry || !isSqlite(dbEntry)) {
      return { ok: false, error: "The selected file is not a ReadLynx backup." };
    }

    const tempDir = await fs.promises.mkdtemp(
      path.join(app.getPath("temp"), "readlynx-restore-"),
    );
    const coversSrcDir = path.join(tempDir, "covers");
    const booksSrcDir = path.join(tempDir, "books");
    try {
      await fs.promises.writeFile(path.join(tempDir, BACKUP_DB_NAME), dbEntry);
      const coverNames = Object.keys(files).filter((name) =>
        name.startsWith(COVERS_PREFIX),
      );
      if (coverNames.length > 0) {
        await fs.promises.mkdir(coversSrcDir, { recursive: true });
        for (const name of coverNames) {
          await fs.promises.writeFile(
            path.join(coversSrcDir, path.basename(name)),
            files[name],
          );
        }
      }
      const bookNames = Object.keys(files).filter((name) =>
        name.startsWith(BOOKS_PREFIX),
      );
      if (bookNames.length > 0) {
        await fs.promises.mkdir(booksSrcDir, { recursive: true });
        for (const name of bookNames) {
          await fs.promises.writeFile(
            path.join(booksSrcDir, path.basename(name)),
            files[name],
          );
        }
      }

      // Swap while the worker is stopped: replace the database file, drop the
      // stale WAL sidecars, then replace the covers and book-source files.
      const liveDbPath = dbPath();
      closeDb();
      try {
        await fs.promises.copyFile(path.join(tempDir, BACKUP_DB_NAME), liveDbPath);
        await fs.promises.rm(`${liveDbPath}-wal`, { force: true });
        await fs.promises.rm(`${liveDbPath}-shm`, { force: true });
        const coversDir = coversDirectory(liveDbPath);
        await fs.promises.rm(coversDir, { recursive: true, force: true });
        if (coverNames.length > 0) {
          await fs.promises.cp(coversSrcDir, coversDir, { recursive: true });
        }
        const booksDir = sourcesDirectory(liveDbPath);
        await fs.promises.rm(booksDir, { recursive: true, force: true });
        if (bookNames.length > 0) {
          await fs.promises.cp(booksSrcDir, booksDir, { recursive: true });
        }
      } finally {
        openDb();
      }
      return { ok: true, path: zipPath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
}