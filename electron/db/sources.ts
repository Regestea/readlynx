import path from "node:path";
import type { FileStore } from "../store/FileStore.ts";

/** Directory name (relative to the store root) where imported PDF/EPUB
 *  source files are copied. Mirrors `COVERS_DIR_NAME` in `covers.ts`. */
export const BOOKS_DIR_NAME = "books";

/** Deletes an imported book-source file. Only removes files that live inside
 *  the books bucket, so an escaped path can never delete arbitrary files. */
export function removeSourceFile(filePath: string, store: FileStore): void {
  // Support both relative keys (books/<file>) and absolute legacy paths
  if (filePath.startsWith("books/")) {
    const fileName = filePath.slice("books/".length);
    store.delete("books", fileName);
    return;
  }
  // Absolute path: extract the filename and delete from the books bucket
  const fileName = path.basename(filePath);
  store.delete("books", fileName);
}
