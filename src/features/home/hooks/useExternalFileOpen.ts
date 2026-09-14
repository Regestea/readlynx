import { useCallback, useEffect, useRef, useState } from "react";
import { bookTitleFromPath, detectBookSourceType } from "../../../shared/bookFiles";

/** Background first-page capture for a freshly imported/refreshed PDF.
 *  Rendered offscreen by the host until `onDone` fires. */
export interface PdfCoverJob {
  bookId: string;
  title: string;
  storedPath: string;
  key: number;
}

/**
 * Handles OS-level "Open with ReadLynx" (file association / double-click)
 * for PDF/EPUB/Markdown files.
 *
 * Policy (auto add-to-library):
 * - Same content (sha256 + size) as an existing book → just open it
 *   (remembering the new pick location when it changed).
 * - Same pick location but changed content → replace the stored copy,
 *   drop stale translations and reset the reading position (same book).
 * - Otherwise → silent import as a reading book (title = file name) and
 *   open it directly in the reader. PDFs get their cover captured
 *   afterwards via {@link PdfCoverJob}.
 */
export function useExternalFileOpen(onOpenReadingBook: (bookId: string) => void) {
  const [coverJob, setCoverJob] = useState<PdfCoverJob | null>(null);
  const busyRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const onOpenRef = useRef(onOpenReadingBook);

  useEffect(() => {
    onOpenRef.current = onOpenReadingBook;
  }, [onOpenReadingBook]);

  const clearCoverJob = useCallback(() => {
    setCoverJob(null);
  }, []);

  const processOne = useCallback(async (sourcePath: string) => {
    const bridge = window.readlynx;
    if (!bridge) return;
    const sourceType = detectBookSourceType(sourcePath);

    // 1. Content identity (cheap size + streaming hash in main).
    const identity = await bridge.fileIdentity(sourcePath).catch(() => null);
    if (!identity) return;

    const { fileHash, fileSize } = identity;

    // 2. Same content, possibly under a different name → open it.
    const byHash = await bridge.db.findBookBySourceHash(fileHash, fileSize).catch(() => null);
    if (byHash) {
      if (byHash.originalPath !== sourcePath) {
        await bridge.db.updateBookOriginalPath(byHash.bookId, sourcePath).catch(() => false);
      }
      await bridge.db.markReadingStateOpened(byHash.bookId).catch(() => false);
      onOpenRef.current(byHash.bookId);
      return;
    }

    // 3. Same origin path but new content → the file was edited outside.
    const byOrigin = await bridge.db.findBookByOriginalPath(sourcePath).catch(() => null);
    if (byOrigin) {
      let storedPath = byOrigin.filePath;
      const replaced = await bridge.replaceSource({ storedPath, sourcePath }).catch(() => false);
      if (!replaced) {
        // Stored copy is gone (or unreadable source) — re-import fresh and
        // keep pointing the same book at the new copy.
        const reimported = await bridge
          .importSource({ sourcePath, sourceType })
          .catch(() => null);
        if (!reimported) return;
        storedPath = reimported;
      }
      await bridge.db
        .refreshBookSource({
          bookId: byOrigin.bookId,
          sourcePath: storedPath,
          fileHash,
          fileSize,
          originalPath: sourcePath,
        })
        .catch(() => false);
      await bridge.db.markReadingStateOpened(byOrigin.bookId).catch(() => false);
      onOpenRef.current(byOrigin.bookId);
      if (byOrigin.sourceType === "pdf") {
        const info = await bridge.db.getBook(byOrigin.bookId).catch(() => null);
        setCoverJob({
          bookId: byOrigin.bookId,
          title: info?.book.title ?? bookTitleFromPath(sourcePath),
          storedPath,
          key: Date.now(),
        });
      }
      return;
    }

    // 4. Brand-new file → silent import + open in the reader.
    const imported = await bridge.importSource({ sourcePath, sourceType }).catch(() => null);
    if (!imported) return;
    const title = bookTitleFromPath(sourcePath).trim() || "Untitled";
    const result = await bridge.db
      .createReadingBook({
        title,
        sourceType,
        sourcePath: imported,
        coverImage: null,
        fileHash,
        fileSize,
        originalPath: sourcePath,
      })
      .catch(() => null);
    if (!result) return;
    await bridge.db.markReadingStateOpened(result.bookId).catch(() => false);
    onOpenRef.current(result.bookId);
    if (sourceType === "pdf") {
      setCoverJob({ bookId: result.bookId, title, storedPath: imported, key: Date.now() });
    }
  }, []);

  const pump = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const runNext = (): void => {
      const next = queueRef.current.shift();
      if (!next) {
        busyRef.current = false;
        return;
      }
      void processOne(next)
        .catch((error: unknown) => {
          console.error("[open-with] failed to open file:", error);
        })
        .finally(runNext);
    };
    runNext();
  }, [processOne]);

  useEffect(() => {
    const bridge = window.readlynx;
    if (!bridge?.onOpenFile || !bridge?.getPendingFile) return;
    const enqueue = (filePath: string) => {
      if (!filePath) return;
      queueRef.current.push(filePath);
      void pump();
    };
    const unsubscribe = bridge.onOpenFile(enqueue);
    // Cold start: the OS handed the file before the renderer mounted.
    void bridge
      .getPendingFile()
      .then((pending) => {
        if (pending) enqueue(pending);
      })
      .catch(() => {
        // No pending file — normal launch.
      });
    return () => unsubscribe?.();
  }, [pump]);

  return { coverJob, clearCoverJob };
}
