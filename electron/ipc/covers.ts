import { ipcMain, nativeImage, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { FileStore } from "../store/FileStore.ts";

const COVER_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/** The shelf renders dozens of covers, and each `<img>` load used to read the
 *  full-resolution file from disk and decode it in the renderer. Serve from a
 *  small mtime-validated in-memory cache and downscale covers to the size the
 *  UI actually displays, so scrolling stays smooth. */
const CACHE_MAX_ENTRIES = 64;
const COVER_TARGET_WIDTH = 480;
const DOWNSCALE_SKIP_EXTENSIONS = new Set([".gif", ".svg", ".avif"]);

interface CoverCacheEntry {
  data: Buffer;
  type: string;
  mtimeMs: number;
}

const coverCache = new Map<string, CoverCacheEntry>();

function cacheCover(
  key: string,
  data: Buffer,
  type: string,
  mtimeMs: number,
): CoverCacheEntry {
  const hit = coverCache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  if (coverCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = coverCache.keys().next().value;
    if (oldest !== undefined) coverCache.delete(oldest);
  }
  const entry = { data, type, mtimeMs };
  coverCache.set(key, entry);
  return entry;
}

function downscaleCover(data: Buffer, ext: string): Buffer | null {
  if (DOWNSCALE_SKIP_EXTENSIONS.has(ext)) return null;
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) return null;
  if (image.getSize().width <= COVER_TARGET_WIDTH) return null;
  const scaled = image.resize({ width: COVER_TARGET_WIDTH, quality: "good" });
  return ext === ".jpg" || ext === ".jpeg" ? scaled.toJPEG(85) : scaled.toPNG();
}

interface CoversIpcDeps {
  getStore: () => FileStore;
}

/** Serves cover image files referenced by relative paths in the database. */
export function registerCoverProtocol({ getStore }: CoversIpcDeps) {
  protocol.handle("readlynx-cover", async (request) => {
    try {
      const store = getStore();
      const filePath = resolveCoverUrlFromStore(store, request.url);
      if (!filePath) {
        return new Response("Forbidden", { status: 403 });
      }
      const fs = await import("node:fs/promises");
      const stat = await fs.stat(filePath);
      const cached = coverCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return new Response(cached.data, {
          headers: { "content-type": cached.type },
        });
      }
      const raw = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = COVER_MIME_TYPES[ext] ?? "application/octet-stream";
      const downscaled = downscaleCover(raw, ext);
      const entry = cacheCover(filePath, downscaled ?? raw, type, stat.mtimeMs);
      return new Response(entry.data, {
        headers: { "content-type": entry.type },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function registerCoversIpc({ getStore }: CoversIpcDeps) {
  ipcMain.handle("cover:read-data-url", async (_event, relativePath: string) => {
    try {
      const store = getStore();
      const rel = relativePath.replace(/^covers\//, "");
      const fileName = path.basename(rel);
      const meta = store.stat("covers", fileName);
      const data = store.get("covers", fileName);
      if (!data || !meta) return null;
      return `data:${meta.contentType};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  });
}

/** Resolves a readlynx-cover:// URL to an absolute file path via FileStore. */
function resolveCoverUrlFromStore(store: FileStore, rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
      .replace(/^covers\//, "");
    const root = path.resolve(store.rootPath, "covers");
    const filePath = path.resolve(root, rel);
    if (!filePath.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(filePath)) return null;
    return filePath;
  } catch {
    return null;
  }
}
