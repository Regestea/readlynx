import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

/** Directory name (relative to the database file) where cover images live. */
export const COVERS_DIR_NAME = "covers";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** Absolute directory for cover files, next to the database file. */
export function coversDirectory(dbPath: string): string {
  return path.join(path.dirname(dbPath), COVERS_DIR_NAME);
}

function decodeDataUrl(dataUrl: string): { data: Buffer; extension: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const extension = MIME_EXTENSIONS[mime] ?? "png";
  return { data: Buffer.from(match[2], "base64"), extension };
}

/** Writes a data URL to the covers directory; returns `covers/<file>` or null. */
function writeDataUrlFile(dataUrl: string, dbPath: string): string | null {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const dir = coversDirectory(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${randomUUID()}.${decoded.extension}`;
  fs.writeFileSync(path.join(dir, fileName), decoded.data);
  return `${COVERS_DIR_NAME}/${fileName}`;
}

/** True when `rel` is a plain `covers/<file>` reference — no subpaths, so it
 *  cannot escape the covers directory. */
function isCoverPath(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.length !== 2) return false;
  const [dir, name] = parts;
  return (
    dir === COVERS_DIR_NAME &&
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    path.basename(name) === name
  );
}

/** Deletes a cover file if it is a known `covers/<file>` reference. */
export function removeCoverFile(rel: string | null, dbPath: string): void {
  if (!rel || !isCoverPath(rel)) return;
  try {
    fs.unlinkSync(path.join(coversDirectory(dbPath), path.basename(rel)));
  } catch {
    // already gone
  }
}

/** Normalizes the cover value coming from the renderer into the relative path
 *  stored in the database. Accepts a data URL (written to disk), an existing
 *  relative path, or a `readlynx-cover://` URL. The previous file is deleted
 *  when the cover is replaced or removed. */
export function persistCoverImage(
  incoming: string | null,
  dbPath: string,
  previous: string | null,
): string | null {
  let next: string | null = null;
  if (incoming) {
    if (incoming.startsWith("data:")) {
      next = writeDataUrlFile(incoming, dbPath);
    } else {
      const protocolUrl = /^readlynx-cover:\/\/[^/]+\/(.+)$/.exec(incoming);
      const rel = protocolUrl ? decodeURIComponent(protocolUrl[1]) : incoming;
      next = isCoverPath(rel) ? `${COVERS_DIR_NAME}/${path.basename(rel)}` : null;
    }
  }
  if (previous && previous !== next) {
    removeCoverFile(previous, dbPath);
  }
  return next;
}

/** Resolves a `readlynx-cover://` request URL to an absolute file path under
 *  the covers directory. Accepts both `covers/<file>` and bare `<file>` path
 *  forms; returns null for anything that escapes the directory. */
export function resolveCoverUrl(dbPath: string, rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
      .replace(/^covers\//, "");
    const root = path.resolve(coversDirectory(dbPath));
    const filePath = path.resolve(root, rel);
    if (!filePath.startsWith(root + path.sep)) return null;
    return filePath;
  } catch {
    return null;
  }
}

/** Converts legacy inline data-URL covers (stored in the column before covers
 *  became files) into files, and nulls out anything unreadable. */
export function migrateLegacyCovers(db: Database.Database, dbPath: string): void {
  const rows = db
    .prepare("SELECT id, coverImage FROM Books WHERE coverImage IS NOT NULL")
    .all() as Array<{ id: string; coverImage: unknown }>;
  const update = db.prepare("UPDATE Books SET coverImage = ? WHERE id = ?");
  for (const row of rows) {
    const raw = row.coverImage;
    const text =
      typeof raw === "string"
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : "";
    let next: string | null = null;
    if (text.startsWith("data:")) {
      next = writeDataUrlFile(text, dbPath);
    } else if (isCoverPath(text)) {
      next = `${COVERS_DIR_NAME}/${path.basename(text)}`;
    }
    update.run(next, row.id);
  }
}
