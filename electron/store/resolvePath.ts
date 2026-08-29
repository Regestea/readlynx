import fs from "node:fs";
import path from "node:path";

/** Resolves a file path that may be either a relative store key
 *  (e.g. `"books/abc.pdf"`) or an absolute path (legacy data).
 *  Returns the absolute path on disk, or null if the file does not exist. */
export function resolveFilePath(
  filePath: string,
  storeRoot: string,
): string | null {
  if (path.isAbsolute(filePath)) {
    return fs.existsSync(filePath) ? filePath : null;
  }
  const resolved = path.join(storeRoot, filePath);
  return fs.existsSync(resolved) ? resolved : null;
}
