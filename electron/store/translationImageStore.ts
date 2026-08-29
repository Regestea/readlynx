import type { FileStore } from "../store/FileStore.ts";

/** Protocol URL prefix for translation images. */
const PROTOCOL_PREFIX = "readlynx-translation-image://local/";

/** Builds a protocol URL for a stored translation image. */
export function buildTranslationImageUrl(bookId: string, chapterKey: string, imgIndex: number, ext: string): string {
  return `${PROTOCOL_PREFIX}${bookId}/${chapterKey}/${imgIndex}.${ext}`;
}

/** Saves an array of data-URL images to the FileStore and returns protocol
 *  URLs in the same order. Non-data URLs are returned as-is. */
export function saveTranslationImages(
  store: FileStore,
  bookId: string,
  chapterKey: string,
  dataUrls: string[],
): string[] {
  const urls: string[] = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const dataUrl = dataUrls[i];
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      urls.push(dataUrl);
      continue;
    }
    const match = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
    if (!match) {
      urls.push(dataUrl);
      continue;
    }
    const ext = match[1].replace("+xml", "").replace("jpeg", "jpg");
    const key = `${bookId}/${chapterKey}/${i}.${ext}`;
    const buf = Buffer.from(match[2], "base64");
    store.put("translation-images", key, buf);
    urls.push(buildTranslationImageUrl(bookId, chapterKey, i, ext));
  }
  return urls;
}

/** Deletes all translation images for a given book+chapter prefix. */
export function deleteTranslationImages(store: FileStore, bookId: string, chapterKeyPrefix?: string): void {
  const prefix = chapterKeyPrefix ? `${bookId}/${chapterKeyPrefix}` : bookId;
  const entries = store.list("translation-images", prefix);
  for (const entry of entries) {
    const rel = entry.key.replace(/^translation-images\//, "");
    store.delete("translation-images", rel);
  }
}

/** Deletes all translation images for a book (used on book delete). */
export function deleteAllBookTranslationImages(store: FileStore, bookId: string): void {
  const entries = store.list("translation-images", bookId);
  for (const entry of entries) {
    const rel = entry.key.replace(/^translation-images\//, "");
    store.delete("translation-images", rel);
  }
}
