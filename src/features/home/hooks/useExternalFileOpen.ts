import { useCallback, useEffect, useRef, useState } from "react";
import { bookTitleFromPath, detectBookSourceType } from "../../../shared/bookFiles";
import type { OpenModeAnswer } from "../../../components/ui/OpenModeDialog/OpenModeDialog";
import type { AppSettingsEntity, BookSourceType } from "../../../infrastructure/db/entities";

/** Background first-page capture for a freshly imported/refreshed PDF.
 *  Rendered offscreen by the host until `onDone` fires. */
export interface PdfCoverJob {
  bookId: string;
  title: string;
  storedPath: string;
  key: number;
}

/** Where the host wants an opened book to end up, and who decides. */
export interface ExternalOpenHandlers {
  /** False in a reader window: it has no tabs to add to, no library, and must
   *  not claim a file that was queued before the shell's renderer mounted. */
  enabled: boolean;
  /** Asked before anything is imported; `defaultAddToLibrary` seeds the keep
   *  checkbox (the file type's Settings switch). "cancel" aborts the whole
   *  open — no copy is written and no library row is created. */
  askOpenMode: (fileName: string, defaultAddToLibrary: boolean) => Promise<OpenModeAnswer>;
  onOpenTab: (bookId: string) => void;
  onOpenWindow: (bookId: string) => void;
}

/** The file type's add-to-library switch in Settings → File import. */
function addToLibrarySwitch(settings: AppSettingsEntity, sourceType: BookSourceType): boolean {
  if (sourceType === "epub") return settings.openWithAddEpub;
  if (sourceType === "markdown") return settings.openWithAddMarkdown;
  return settings.openWithAddPdf;
}

/**
 * Handles OS-level "Open with ReadLynx" (file association / double-click)
 * for PDF/EPUB/Markdown files.
 *
 * Policy (content dedupe, per-open library placement):
 * - Same content (sha256 + size) as an existing book → just open it
 *   (remembering the new pick location when it changed). If that book was a
 *   temporary session copy and the user asked to keep the file, it is
 *   promoted into the library first (getting its PDF cover too).
 * - Same pick location but changed content → replace the stored copy,
 *   drop stale translations and reset the reading position (same book).
 * - Otherwise → import as a reading book (title = file name) and open it.
 *   PDFs get their cover captured afterwards via {@link PdfCoverJob}.
 *
 * Whether a brand-new import joins the library follows the keep checkbox in
 * the open dialog, seeded with the file type's "add to library" switch in
 * Settings → File import. Unchecked, the book is created `temporary`: it
 * reads like any other book but is hidden from the shelf and stats, and is
 * removed at the next launch (deduped within this session if the same file
 * is reopened).
 *
 * The question of *where* it opens (a tab here, or its own window) is asked
 * before any of that work starts, so declining leaves the library untouched.
 */
export function useExternalFileOpen(handlers: ExternalOpenHandlers) {
  const [coverJob, setCoverJob] = useState<PdfCoverJob | null>(null);
  const busyRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const clearCoverJob = useCallback(() => {
    setCoverJob(null);
  }, []);

  const processOne = useCallback(async (sourcePath: string) => {
    const bridge = window.readlynx;
    if (!bridge) return;
    const sourceType = detectBookSourceType(sourcePath);

    // The file type's switch seeds the dialog's keep checkbox (a failed read
    // keeps the old always-add behavior). Reads before the dialog — cancelling
    // must still not import, hash or write anything.
    const settings = await bridge.db.getAppSettings().catch(() => null);
    const defaultAddToLibrary = !settings || addToLibrarySwitch(settings, sourceType);

    // Asked first: cancelling must not import, hash or write anything.
    const answer = await handlersRef.current.askOpenMode(
      bookTitleFromPath(sourcePath),
      defaultAddToLibrary,
    );
    if (answer.mode === "cancel") return;
    const open =
      answer.mode === "window" ? handlersRef.current.onOpenWindow : handlersRef.current.onOpenTab;
    const addToLibrary = answer.addToLibrary;

    // 1. Content identity (cheap size + streaming hash in main).
    const identity = await bridge.fileIdentity(sourcePath).catch(() => null);
    if (!identity) return;

    const { fileHash, fileSize } = identity;

    // 2. Same content, possibly under a different name → open it. A kept
    //    duplicate of a temporary copy is promoted into the library first —
    //    the checkbox said "save this file", and the PDF cover follows.
    const byHash = await bridge.db.findBookBySourceHash(fileHash, fileSize).catch(() => null);
    if (byHash) {
      if (addToLibrary && byHash.temporary === 1) {
        const promoted = await bridge.db.setBookTemporary(byHash.bookId, false).catch(() => false);
        if (promoted && byHash.sourceType === "pdf") {
          setCoverJob({
            bookId: byHash.bookId,
            title: bookTitleFromPath(sourcePath),
            storedPath: byHash.filePath,
            key: Date.now(),
          });
        }
      }
      if (byHash.originalPath !== sourcePath) {
        await bridge.db.updateBookOriginalPath(byHash.bookId, sourcePath).catch(() => false);
      }
      await bridge.db.markReadingStateOpened(byHash.bookId).catch(() => false);
      open(byHash.bookId);
      return;
    }

    // 3. Same origin path but new content → the file was edited outside.
    const byOrigin = await bridge.db.findBookByOriginalPath(sourcePath).catch(() => null);
    if (byOrigin) {
      if (addToLibrary && byOrigin.temporary === 1) {
        const promoted = await bridge.db
          .setBookTemporary(byOrigin.bookId, false)
          .catch(() => false);
        if (promoted && byOrigin.sourceType === "pdf") {
          setCoverJob({
            bookId: byOrigin.bookId,
            title: bookTitleFromPath(sourcePath),
            storedPath: byOrigin.filePath,
            key: Date.now(),
          });
        }
      }
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
      open(byOrigin.bookId);
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

    // 4. Brand-new file → import + open. With the type's switch off it
    //    becomes a session-only book: it reads the same, but the shelf and
    //    the stats never see it, and it is purged at the next launch.
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
        temporary: !addToLibrary,
      })
      .catch(() => null);
    if (!result) {
      // The book row never landed: delete the store copy it would have
      // pointed at, so a failed import leaves no orphan file behind.
      await bridge.deleteStoredSource?.(imported).catch(() => false);
      return;
    }
    await bridge.db.markReadingStateOpened(result.bookId).catch(() => false);
    open(result.bookId);
    // A temporary book is never shown on the shelf, so its cover would only
    // be written to be deleted alongside it.
    if (sourceType === "pdf" && addToLibrary) {
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
    if (!handlersRef.current.enabled) return;
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
