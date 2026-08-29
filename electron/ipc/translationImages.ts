import { ipcMain, protocol } from "electron";
import path from "node:path";
import type { FileStore } from "../store/FileStore.ts";
import {
  saveTranslationImages,
  deleteTranslationImages,
  deleteAllBookTranslationImages,
} from "../store/translationImageStore.ts";

export { saveTranslationImages, deleteTranslationImages, deleteAllBookTranslationImages } from "../store/translationImageStore.ts";

const TRANSLATION_IMG_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

interface TranslationImagesIpcDeps {
  getStore: () => FileStore;
}

/** Serves translation images via a custom protocol so EPUB translated
 *  markdown can reference persisted images without bloating the database. */
export function registerTranslationImageProtocol({ getStore }: TranslationImagesIpcDeps) {
  protocol.handle("readlynx-translation-image", async (request) => {
    try {
      const store = getStore();
      const url = new URL(request.url);
      // URL format: readlynx-translation-image://local/<bookId>/<chapterKey>/<imgIndex>.png
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const parts = pathname.split("/");
      if (parts.length < 3) {
        return new Response("Invalid path", { status: 400 });
      }
      const bookId = parts[0];
      const chapterKey = parts[1];
      const fileName = parts.slice(2).join("/");
      const key = `${bookId}/${chapterKey}/${fileName}`;
      const data = store.get("translation-images", key);
      if (!data) {
        return new Response("Not found", { status: 404 });
      }
      const ext = path.extname(fileName).toLowerCase();
      const contentType = TRANSLATION_IMG_MIME_TYPES[ext] ?? "application/octet-stream";
      return new Response(data, {
        headers: { "content-type": contentType },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function registerTranslationImagesIpc({ getStore }: TranslationImagesIpcDeps) {
  ipcMain.handle("translation-images:save", (_event, payload: {
    bookId: string;
    chapterKey: string;
    dataUrls: string[];
  }) => {
    const store = getStore();
    return saveTranslationImages(store, payload.bookId, payload.chapterKey, payload.dataUrls);
  });

  ipcMain.handle("translation-images:delete", (_event, payload: {
    bookId: string;
    chapterKeyPrefix?: string;
  }) => {
    const store = getStore();
    deleteTranslationImages(store, payload.bookId, payload.chapterKeyPrefix);
    return true;
  });

  ipcMain.handle("translation-images:delete-all-for-book", (_event, bookId: string) => {
    const store = getStore();
    deleteAllBookTranslationImages(store, bookId);
    return true;
  });
}
