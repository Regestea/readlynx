import fs from "node:fs";
import path from "node:path";

/** Directory name (relative to the database file) where imported PDF/EPUB
 *  source files are copied. Mirrors `COVERS_DIR_NAME` in `covers.ts`. */
export const BOOKS_DIR_NAME = "books";

/** Absolute directory for imported book-source files, next to the database. */
export function sourcesDirectory(dbPath: string): string {
  return path.join(path.dirname(dbPath), BOOKS_DIR_NAME);
}

/** Deletes an imported book-source file. Only removes files that live inside
 *  the books directory, so an escaped path can never delete arbitrary files. */
export function removeSourceFile(filePath: string, dbPath: string): void {
  const root = path.resolve(sourcesDirectory(dbPath));
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
  try {
    fs.unlinkSync(resolved);
  } catch {
    // already gone
  }
}