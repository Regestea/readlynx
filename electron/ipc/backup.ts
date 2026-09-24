import { BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Unzip, UnzipInflate, Zip, ZipDeflate } from "fflate";
import type { DbWorkerClient } from "../db/client.ts";
import type { FileStore } from "../store/FileStore.ts";
import type { BucketName } from "../store/buckets.ts";

const BACKUP_DB_NAME = "readlynx.db";
const COVERS_PREFIX = "covers/";
const BOOKS_PREFIX = "books/";
const TRANSLATION_IMAGES_PREFIX = "translation-images/";
const BACKED_UP_BUCKETS: BucketName[] = ["covers", "books", "translation-images"];

/** Hard caps against zip bombs / OOM. Libraries are typically tens of MB;
 *  these limits are generous but keep a corrupt archive from killing the app. */
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** `readlynx-backup-2026-08-15-1430.zip` — local time, minutes precision. */
function backupStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

interface StagedFile {
  /** posix-style path relative to the bucket root (`a.png`, `book/ch/0.png`). */
  rel: string;
  abs: string;
  size: number;
}

/** Recursively lists regular files under `dir` (relative posix paths).
 *  Symlinks and special files are skipped so a crafted store directory
 *  cannot make the backup read arbitrary paths. */
async function listFilesRecursive(dir: string): Promise<StagedFile[]> {
  const out: StagedFile[] = [];
  async function walk(current: string, relBase: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (rel.length > 500) continue;
      let stat: fs.Stats;
      try {
        stat = await fs.promises.lstat(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(abs, rel);
      } else if (stat.isFile()) {
        out.push({ rel, abs, size: stat.size });
      }
    }
  }
  await walk(dir, "");
  return out;
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

/** Opens the staged snapshot read-only and checks it really is a ReadLynx
 *  database (expected tables, readable). Throws otherwise. */
function assertValidDatabaseFile(dbPath: string): void {
  const fd = fs.openSync(dbPath, "r");
  try {
    const header = Buffer.alloc(16);
    const read = fs.readSync(fd, header, 0, 16, 0);
    if (read < 16 || !isSqlite(header)) {
      throw new Error("The selected file is not a ReadLynx backup.");
    }
  } finally {
    fs.closeSync(fd);
  }
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const required of ["Books", "Documents", "BookSources"]) {
      if (!names.has(required)) {
        throw new Error("The selected file is not a ReadLynx backup.");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "The selected file is not a ReadLynx backup.") {
      throw error;
    }
    throw new Error("The backup database is corrupt and cannot be restored.", { cause: error });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }
}

/** Validates one zip entry name and maps it to a safe staging target.
 *  Returns null for unknown top-level prefixes (ignored for forward
 *  compatibility). Throws on traversal / malformed entries. */
function mapZipEntry(
  name: string,
  staging: { covers: string; books: string; translationImages: string; dbFile: string },
): { target: string } | null {
  if (!name || name.includes("\\") || name.startsWith("/") || name.includes("\0")) {
    throw new Error(`Invalid entry in backup: "${name}"`);
  }
  const parts = name.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`Invalid entry in backup: "${name}"`);
  }
  if (parts.some((p) => p.length > 255) || name.length > 500) {
    throw new Error(`Invalid entry in backup: "${name}"`);
  }
  if (name === BACKUP_DB_NAME) return { target: staging.dbFile };
  if (name.startsWith(COVERS_PREFIX)) {
    const rest = name.slice(COVERS_PREFIX.length);
    if (!rest || rest.includes("/")) throw new Error(`Invalid entry in backup: "${name}"`);
    return { target: path.join(staging.covers, rest) };
  }
  if (name.startsWith(BOOKS_PREFIX)) {
    const rest = name.slice(BOOKS_PREFIX.length);
    if (!rest || rest.includes("/")) throw new Error(`Invalid entry in backup: "${name}"`);
    return { target: path.join(staging.books, rest) };
  }
  if (name.startsWith(TRANSLATION_IMAGES_PREFIX)) {
    const rest = name.slice(TRANSLATION_IMAGES_PREFIX.length);
    if (!rest || rest.split("/").length > 5) {
      throw new Error(`Invalid entry in backup: "${name}"`);
    }
    return { target: path.join(staging.translationImages, ...rest.split("/")) };
  }
  return null;
}

/** Streams and validates a backup zip into staging dirs without ever holding
 *  the whole archive (compressed + uncompressed) in memory at once. */
async function extractBackupZip(
  zipPath: string,
  staging: { covers: string; books: string; translationImages: string; dbFile: string },
): Promise<{ dbBytes: number; fileCount: number; uncompressedBytes: number }> {
  const zipStat = await fs.promises.stat(zipPath);
  if (zipStat.size > MAX_ZIP_BYTES) {
    throw new Error("This backup file is too large to restore safely.");
  }
  await fs.promises.mkdir(staging.covers, { recursive: true });
  await fs.promises.mkdir(staging.books, { recursive: true });
  await fs.promises.mkdir(staging.translationImages, { recursive: true });

  let fileCount = 0;
  let uncompressedBytes = 0;
  let sawDb = false;
  const stagingRoot = path.resolve(path.dirname(staging.dbFile));
  const pending: Array<Promise<void>> = [];
  let streamError: Error | null = null;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      streamError = error;
      reject(error);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    let unzip: Unzip;
    try {
      unzip = new Unzip((file) => {
        if (streamError) return;
        let mapped: { target: string } | null;
        try {
          mapped = mapZipEntry(file.name, staging);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (!mapped) return; // unknown prefix — skip for forward compatibility
        fileCount += 1;
        if (fileCount > MAX_FILES) {
          fail(new Error("This backup contains too many files to restore safely."));
          return;
        }
        const resolved = path.resolve(mapped.target);
        const allowedRoots = [
          path.resolve(staging.covers),
          path.resolve(staging.books),
          path.resolve(staging.translationImages),
          stagingRoot,
        ];
        if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
          fail(new Error(`Invalid entry in backup: "${file.name}"`));
          return;
        }
        if (file.name === BACKUP_DB_NAME) sawDb = true;
        try {
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        let out: fs.WriteStream;
        try {
          out = fs.createWriteStream(resolved);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        let fileBytes = 0;
        const task = new Promise<void>((res, rej) => {
          out.on("error", rej);
          file.ondata = (error, chunk, final) => {
            if (streamError) return;
            if (error) {
              out.destroy(error);
              rej(error);
              return;
            }
            if (chunk.length > 0) {
              fileBytes += chunk.length;
              uncompressedBytes += chunk.length;
              if (fileBytes > MAX_SINGLE_FILE_BYTES || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
                const tooBig = new Error("This backup is too large to restore safely.");
                out.destroy(tooBig);
                fail(tooBig);
                rej(tooBig);
                return;
              }
            }
            if (chunk.length > 0) {
              out.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), (writeError) => {
                if (writeError) {
                  rej(writeError);
                  return;
                }
                if (final) out.end(() => res());
              });
            } else if (final) {
              out.end(() => res());
            }
          };
        });
        pending.push(task);
        task.catch(fail);
        file.start();
      });
      // DEFLATE entries (everything `ZipDeflate` writes) need an explicit
      // decoder — without this every file fails with "unknown compression".
      unzip.register(UnzipInflate);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const source = fs.createReadStream(zipPath);
    source.on("error", (error) => fail(error));
    source.on("data", (chunk: Buffer | string) => {
      if (streamError) return;
      if (typeof chunk === "string") {
        fail(new Error("Failed to read the backup file."));
        return;
      }
      try {
        unzip.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), false);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    source.on("end", () => {
      if (streamError) return;
      try {
        unzip.push(new Uint8Array(0), true);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      // `Unzip` delivers file data synchronously during push(); wait a tick
      // for all ondata handlers, then finish once pending writes resolve.
      queueMicrotask(() => {
        void Promise.all(pending).then(
          () => done(),
          (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
        );
      });
    });
  });

  if (!sawDb) throw new Error("The selected file is not a ReadLynx backup.");
  let stagedStat: fs.Stats;
  try {
    stagedStat = await fs.promises.stat(staging.dbFile);
  } catch {
    throw new Error("The selected file is not a ReadLynx backup.");
  }
  assertValidDatabaseFile(staging.dbFile);
  return { dbBytes: stagedStat.size, fileCount, uncompressedBytes };
}

/** Appends files to a zip archive one at a time and streams the result to
 *  disk, so peak memory is one file (not the whole library). Writes to a
 *  temp sibling first and renames atomically on success. */
async function writeZipStreamed(
  filePath: string,
  jobs: Array<{ name: string; abs: string }>,
): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const out = fs.createWriteStream(tmpPath);
      out.on("error", fail);
      out.on("finish", succeed);
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          fail(error);
          out.destroy();
          return;
        }
        out.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), (writeError) => {
          if (writeError) {
            fail(writeError);
            return;
          }
          if (final) out.end();
        });
      });
      void (async () => {
        try {
          for (const job of jobs) {
            const data = await fs.promises.readFile(job.abs);
            const entry = new ZipDeflate(job.name, { level: 6 });
            zip.add(entry);
            entry.push(data, true);
          }
          zip.end();
        } catch (error) {
          fail(error);
        }
      })();
    });
    await fs.promises.rename(tmpPath, filePath);
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

export interface BackupIpcDeps {
  /** Absolute path of the live database file. */
  dbPath: () => string;
  /** The current DB worker client, or null while it is stopped. */
  getClient: () => DbWorkerClient | null;
  /** Stops the DB worker (awaited so the file lock is released). */
  closeDb: () => void | Promise<void>;
  /** Starts a fresh DB worker against the (swapped) database file. */
  openDb: () => void | Promise<void>;
  /** Returns the FileStore instance. */
  getStore: () => FileStore;
}

/** Backup = a single zip with the SQLite snapshot (`readlynx.db`, produced by
 *  the worker's backup API so WAL content is included) plus the covers,
 *  book-source and translation-image directories. Restore = stream-extract,
 *  validate, stop the DB worker, atomically swap the file and directories
 *  (with rollback), then start the worker again on the restored database.
 *  The `ocr`/`exports`/`temp` buckets are intentionally excluded: OCR models
 *  are re-downloadable and the rest is transient cache. */
export function registerBackupIpc({ dbPath, getClient, closeDb, openDb, getStore }: BackupIpcDeps) {
  ipcMain.handle("backup:create", async (event): Promise<{ ok: boolean; path?: string; error?: string } | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save ReadLynx backup",
      defaultPath: `readlynx-backup-${backupStamp()}.zip`,
      filters: [{ name: "ReadLynx backup", extensions: ["zip"] }],
    });
    if (canceled || !filePath) return null;
    const destPath = filePath.toLowerCase().endsWith(".zip") ? filePath : `${filePath}.zip`;

    const client = getClient();
    if (!client) return { ok: false, error: "The database is not available." };

    const store = getStore();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "readlynx-backup-"));
    try {
      const dbFile = path.join(tempDir, BACKUP_DB_NAME);
      await client.createBackup(dbFile);
      assertValidDatabaseFile(dbFile);

      const jobs: Array<{ name: string; abs: string }> = [{ name: BACKUP_DB_NAME, abs: dbFile }];
      let totalBytes = (await fs.promises.stat(dbFile)).size;
      for (const bucket of BACKED_UP_BUCKETS) {
        const prefix = `${bucket}/`;
        const dir = path.join(store.rootPath, bucket);
        const staged = await listFilesRecursive(dir);
        for (const file of staged) {
          if (file.size > MAX_SINGLE_FILE_BYTES) {
            throw new Error(`"${file.rel}" is too large to back up safely.`);
          }
          totalBytes += file.size;
          if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
            throw new Error("This library is too large to back up into a single file.");
          }
          if (jobs.length >= MAX_FILES) {
            throw new Error("This library contains too many files to back up.");
          }
          jobs.push({ name: `${prefix}${file.rel}`, abs: file.abs });
        }
      }
      await writeZipStreamed(destPath, jobs);
      return { ok: true, path: destPath };
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

    const store = getStore();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "readlynx-restore-"));
    const staging = {
      covers: path.join(tempDir, "staging", "covers"),
      books: path.join(tempDir, "staging", "books"),
      translationImages: path.join(tempDir, "staging", "translation-images"),
      dbFile: path.join(tempDir, "staging", BACKUP_DB_NAME),
    };
    const rollbackDir = path.join(tempDir, "rollback");
    try {
      await extractBackupZip(zipPath, staging);

      // Swap while the worker is stopped: replace the database file
      // atomically (temp + rename), drop the stale WAL sidecars, then
      // replace the covers, book-source and translation-image files.
      // The previous library is staged under rollbackDir first so a
      // half-finished swap can be undone instead of corrupting everything.
      const liveDbPath = dbPath();
      await closeDb();
      try {
        await fs.promises.mkdir(rollbackDir, { recursive: true });
        try {
          await fs.promises.copyFile(liveDbPath, path.join(rollbackDir, BACKUP_DB_NAME));
        } catch {
          // No live database yet (first run) — nothing to roll back to.
        }
        for (const bucket of BACKED_UP_BUCKETS) {
          const liveBucketDir = path.join(store.rootPath, bucket);
          try {
            await fs.promises.cp(liveBucketDir, path.join(rollbackDir, bucket), { recursive: true });
          } catch {
            // Bucket may not exist yet — nothing to roll back.
          }
        }

        const swapDbTmp = `${liveDbPath}.restore-tmp`;
        try {
          await fs.promises.copyFile(staging.dbFile, swapDbTmp);
          await fs.promises.rename(swapDbTmp, liveDbPath);
        } finally {
          await fs.promises.rm(swapDbTmp, { force: true });
        }
        await fs.promises.rm(`${liveDbPath}-wal`, { force: true });
        await fs.promises.rm(`${liveDbPath}-shm`, { force: true });
        for (const bucket of BACKED_UP_BUCKETS) {
          const stagedDir =
            bucket === "covers"
              ? staging.covers
              : bucket === "books"
                ? staging.books
                : staging.translationImages;
          store.clearBucket(bucket);
          let hasFiles = false;
          try {
            const entries = await fs.promises.readdir(stagedDir);
            hasFiles = entries.length > 0;
          } catch {
            hasFiles = false;
          }
          if (hasFiles) {
            store.copyToBucket(bucket, stagedDir);
          }
        }
      } catch (swapError) {
        // Best-effort rollback: put the previous DB and buckets back.
        try {
          const prevDb = path.join(rollbackDir, BACKUP_DB_NAME);
          if (fs.existsSync(prevDb)) {
            const tmp = `${liveDbPath}.rollback-tmp`;
            await fs.promises.copyFile(prevDb, tmp);
            await fs.promises.rename(tmp, liveDbPath);
          }
        } catch {
          // Rollback itself failed — surface the original swap error.
        }
        for (const bucket of BACKED_UP_BUCKETS) {
          try {
            const prevBucket = path.join(rollbackDir, bucket);
            if (fs.existsSync(prevBucket)) {
              store.clearBucket(bucket);
              store.copyToBucket(bucket, prevBucket);
            }
          } catch {
            // Keep going — report the original failure below.
          }
        }
        throw swapError;
      } finally {
        await openDb();
      }
      return { ok: true, path: zipPath };
    } catch (error) {
      if (error instanceof Error && error.message === "The selected file is not a ReadLynx backup.") {
        return { ok: false, error: "The selected file is not a ReadLynx backup." };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
}
