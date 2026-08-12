import { app, ipcMain, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveCoverUrl } from "../db/covers.ts";

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

/** Serves cover image files referenced by relative paths in the database. */
export function registerCoverProtocol() {
  protocol.handle("readlynx-cover", async (request) => {
    try {
      const dbPath = path.join(app.getPath("userData"), "readlynx.db");
      const filePath = resolveCoverUrl(dbPath, request.url);
      if (!filePath) {
        return new Response("Forbidden", { status: 403 });
      }
      const data = await fs.promises.readFile(filePath);
      const type = COVER_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
      return new Response(data, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function registerCoversIpc() {
  ipcMain.handle("cover:read-data-url", async (_event, relativePath: string) => {
    try {
      const dbPath = path.join(app.getPath("userData"), "readlynx.db");
      const root = path.resolve(path.dirname(dbPath), "covers");
      const rel = relativePath.replace(/^covers\//, "");
      const filePath = path.resolve(root, rel);
      if (!filePath.startsWith(root + path.sep)) return null;
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = COVER_MIME_TYPES[ext] ?? "application/octet-stream";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  });
}
