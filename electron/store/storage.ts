import { app } from "electron";
import path from "node:path";
import { FileStore } from "./FileStore.ts";

let store: FileStore | null = null;

/** Returns the singleton FileStore instance. Initializes on first call. */
export function getStore(): FileStore {
  if (!store) {
    const storeRoot = path.join(app.getPath("userData"), "store");
    store = new FileStore(storeRoot);
    store.init();
  }
  return store;
}

/** Resolves the absolute path for a stored key. Useful for legacy code that
 *  needs the full path (e.g., PDF viewer reading source files). */
export function resolveStoredPath(key: string): string | null {
  if (!store) return null;
  return store.resolve(key);
}
