import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, FileWarning, Languages, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/Button/Button";
import { PdfViewer } from "../../components/pdfViewer/PdfViewer";
import type { PdfViewerHandle } from "../../components/pdfViewer/PdfViewer";
import { EpubViewer } from "../../components/epubViewer/EpubViewer";
import type { EpubViewerHandle } from "../../components/epubViewer/EpubViewer";
import { Markdown } from "../../components/markdown/Markdown";
import { AiChatPanel } from "../../components/aiChat/AiChatPanel";
import type { BookSourceType } from "../../infrastructure/db/entities";
import { TranslationSettingsPanel, TranslationToggle } from "./translation/TranslationPanel";
import { useTranslation } from "./translation/useTranslation";
import {
  epubUnitKey,
  mdUnitKey,
  methodFor,
  pdfUnitKey,
  unitToChapter,
  unitToPage,
} from "./translation/types";
import { useCloseFlush } from "../../shared/closeFlush";
import {
  loadScrollRatio,
  markdownRatio,
  restoreMarkdownRatio,
  saveScrollRatio,
} from "./scrollMemory";
import styles from "./ReadingPage.module.css";

/** Decodes raw file bytes as UTF-8 Markdown text (strips a BOM when present). */
function decodeMarkdownBytes(data: ArrayBuffer): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  return text.replace(/^\uFEFF/, "");
}

interface ReadingPageProps {
  bookId: string;
  onBack?: () => void;
}

/** Reading is counted while the user is on this page and interacting with
 *  the app in any way (click, key, scroll — chat included). After 15
 *  minutes without any interaction the session pauses, so nobody has to
 *  worry about "proving" they are reading. */
const ACTIVITY_IDLE_MS = 15 * 60 * 1000;
/** Heartbeat interval: each beat persists the segment elapsed so far, so a
 *  crash or kill loses at most one interval. */
const HEARTBEAT_MS = 5 * 60 * 1000;

interface ReadingBook {
  title: string;
  sourceType: BookSourceType;
  filePath: string;
}

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; book: ReadingBook };

export function ReadingPage({ bookId, onBack }: ReadingPageProps) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [savedPage, setSavedPage] = useState(1);
  const [savedChapter, setSavedChapter] = useState<string | null>(null);
  /** Total pages of the loaded PDF (0 until the viewer reports it). */
  const [pageCount, setPageCount] = useState(0);
  /** Total chapters of the loaded EPUB (0 until the viewer reports it). */
  const [chapterCount, setChapterCount] = useState(0);
  /** Original Markdown file text (only for `markdown` books; null while loading). */
  const [markdownSource, setMarkdownSource] = useState<string | null>(null);
  const [markdownSourceError, setMarkdownSourceError] = useState<string | null>(null);
  const [aiContext, setAiContext] = useState<string | null>(null);
  const [pdfAskImages, setPdfAskImages] = useState<string[] | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pdfAskBusy, setPdfAskBusy] = useState(false);
  /** True once the EPUB viewer has finished loading and its chapter DOM is
   *  available for image extraction. Needed so cached translations can
   *  resolve [IMG-n] tokens into real image URLs. */
  const [epubReady, setEpubReady] = useState(false);
  const askPdfRef = useRef(false);
  const pdfRef = useRef<PdfViewerHandle | null>(null);
  const epubRef = useRef<EpubViewerHandle | null>(null);
  /** Scrollable element of the translation Markdown. Each view (original /
   *  translation) keeps its own scroll position — switching never copies an
   *  offset across, so there is no jump. Persisted per book+unit. */
  const translationScrollRef = useRef<HTMLDivElement | null>(null);
  /** Scrollable element of the original Markdown view (markdown books only).
   *  The EPUB original scrolls inside its own viewer (see epubRef). */
  const originalMarkdownScrollRef = useRef<HTMLDivElement | null>(null);
  /** Unit keys already restored, so content re-renders (zoom, images) don't
   *  snap the user back to a stale saved position. */
  const restoredUnitsRef = useRef<Set<string>>(new Set());
  /** Debounce timer for scroll-event saves (localStorage is synchronous). */
  const saveTimerRef = useRef<number | null>(null);
  const prevEpubChapterRef = useRef<string | null>(null);
  const prevTransUnitRef = useRef<string | null>(null);
  /** Last position write still in flight, so closing waits for the worker to
   *  finish it before the app quits. */
  const lastPositionWriteRef = useRef<Promise<unknown> | null>(null);
  /** Guards against double-counting a session (back button + unmount +
   *  app-quit flush can all fire around the same close). */
  const timeFlushedRef = useRef(false);
  /** Ledger-based reading tracker: a session runs while the book is open and
   *  activity is detected; heartbeats persist counted segments every
   *  HEARTBEAT_MS so a crash loses at most one interval. Idle or hidden
   *  windows stop counting; the next interaction resumes. */
  const sessionStartedRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const segStartRef = useRef<number | null>(null);
  const lastActivityRef = useRef(0);
  const heartbeatRef = useRef<number | null>(null);
  /** Latest EPUB position 0..1 reported by the viewer, kept in a ref so
   *  closes can persist it after the viewer is gone. */
  const epubProgressRef = useRef(0);

  const readyBook = state.status === "ready" ? state.book : null;
  const translation = useTranslation({
    bookId,
    sourceType: readyBook?.sourceType ?? "pdf",
    pdfRef,
    epubRef,
    epubReady,
    markdownText: markdownSource,
  });
  const { setUnit: setTranslationUnit } = translation;

  /** Persists the current segment up to `endAt` into the ledger. With
   *  `keepActive` the session continues from `endAt` (crash checkpoint);
   *  otherwise the session is closed (idle, hidden window). */
  const pushSegment = useCallback(
    (endAt: number, keepActive: boolean): Promise<unknown> | null => {
      const start = segStartRef.current;
      segStartRef.current = null;
      if (start === null || endAt <= start) {
        if (keepActive) segStartRef.current = endAt;
        else sessionActiveRef.current = false;
        return null;
      }
      const write = window.readlynx?.db.appendReadingEvent(bookId, start, endAt) ?? null;
      if (keepActive) segStartRef.current = endAt;
      else sessionActiveRef.current = false;
      return write;
    },
    [bookId],
  );

  /** Marks any interaction with the app (while on this page) as reading
   *  activity and resumes a paused session (idle or hidden). Interactions
   *  before the book is ready are ignored. */
  const onActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!sessionStartedRef.current || sessionActiveRef.current || timeFlushedRef.current) return;
    sessionActiveRef.current = true;
    segStartRef.current = Date.now();
  }, []);

  /** Hidden windows stop counting (nobody is reading them); coming back
   *  into view is treated like any other activity. */
  const onVisibilityChange = useCallback(() => {
    if (document.hidden) {
      if (!sessionActiveRef.current) return;
      lastActivityRef.current = Date.now();
      pushSegment(Date.now(), false);
    } else {
      onActivity();
    }
  }, [pushSegment, onActivity]);

  /** Heartbeat tick: persists the segment elapsed so far (so a crash loses
   *  at most one interval) and stops counting once idle / hidden. */
  const tickHeartbeat = useCallback(() => {
    if (!sessionActiveRef.current || timeFlushedRef.current) return;
    const now = Date.now();
    if (now - lastActivityRef.current >= ACTIVITY_IDLE_MS || document.hidden) {
      const start = segStartRef.current;
      pushSegment(start !== null ? Math.max(lastActivityRef.current, start) : now, false);
    } else {
      pushSegment(now, true);
    }
  }, [pushSegment]);

  /** Counts the session into the ledger and finalizes the book (marks it
   *  finished when closed at >= 95%). Returns the in-flight writes so
   *  closing the window can await them; a no-op once the session has been
   *  counted. */
  const flushSession = useCallback((): Promise<unknown> | null => {
    if (timeFlushedRef.current) return null;
    timeFlushedRef.current = true;
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    sessionActiveRef.current = false;
    const start = segStartRef.current;
    segStartRef.current = null;
    const writes: Array<Promise<unknown>> = [];
    if (start !== null) {
      const write = window.readlynx?.db.appendReadingEvent(bookId, start, Date.now());
      if (write) writes.push(write);
    }
    const finish = window.readlynx?.db.finalizeReadingState(bookId);
    if (finish) writes.push(finish);
    return writes.length ? Promise.all(writes) : null;
  }, [bookId]);

  /** Every interaction with the app counts as reading activity while the
   *  book is open — clicks, keys, wheel/touch and capture-phase scrolling
   *  anywhere in the window (translation Markdown and the AI chat included).
   *  Nothing here requires the user to keep scrolling a page. */
  useEffect(() => {
    const onScrollCapture = () => onActivity();
    document.addEventListener("mousedown", onActivity);
    document.addEventListener("wheel", onActivity);
    document.addEventListener("touchstart", onActivity);
    document.addEventListener("scroll", onScrollCapture, true);
    document.addEventListener("keydown", onActivity);
    return () => {
      document.removeEventListener("mousedown", onActivity);
      document.removeEventListener("wheel", onActivity);
      document.removeEventListener("touchstart", onActivity);
      document.removeEventListener("scroll", onScrollCapture, true);
      document.removeEventListener("keydown", onActivity);
    };
  }, [onActivity]);

  useEffect(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [onVisibilityChange]);

  useEffect(() => {
    let cancelled = false;
    const db = window.readlynx?.db;
    if (!db) return;
    // Note: `markdownSource` starts as null per mount (the page is keyed by
    // book id), so no synchronous reset is needed here.
    void Promise.all([db.getBook(bookId), db.getReadingState(bookId)]).then(([result, reading]) => {
      if (cancelled) return;
      if (!result?.source) {
        setState({ status: "error", message: "This book has no source file to display." });
        return;
      }
      setSavedPage(reading?.currentPage ?? 1);
      setSavedChapter(reading?.currentChapter || null);
      prevEpubChapterRef.current = reading?.currentChapter || null;
      prevTransUnitRef.current = null;
      restoredUnitsRef.current.clear();
      const rawType = String(result.source.sourceType ?? "pdf").toLowerCase();
      const sourceType: BookSourceType =
        rawType === "epub" ? "epub" : rawType === "markdown" || rawType === "md" ? "markdown" : "pdf";
      setState({
        status: "ready",
        book: {
          title: result.book.title,
          sourceType,
          filePath: result.source.filePath,
        },
      });
      if (sourceType === "markdown") {
        // Markdown books are a single translation unit; the viewer shows the
        // whole file and the pipeline chunks it for the AI.
        setTranslationUnit(mdUnitKey());
        void window.readlynx?.readFileBytes(result.source.filePath).then((data) => {
          if (cancelled) return;
          if (!data) {
            setMarkdownSourceError("Could not read the Markdown file. It may have been moved or deleted.");
            return;
          }
          try {
            setMarkdownSource(decodeMarkdownBytes(data));
          } catch {
            setMarkdownSourceError("Could not decode the Markdown file as UTF-8 text.");
          }
        });
      }
      // Records "last read" so the book can be offered as a continue-reading
      // entry, and creates the state row when this is the first open.
      void db.markReadingStateOpened(bookId);
      // Starts the reading session: activity-based, checkpointed by the
      // heartbeat (counted until the book is closed).
      sessionStartedRef.current = true;
      sessionActiveRef.current = true;
      segStartRef.current = Date.now();
      lastActivityRef.current = Date.now();
      timeFlushedRef.current = false;
      if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = window.setInterval(tickHeartbeat, HEARTBEAT_MS);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, tickHeartbeat, setTranslationUnit]);

  const handlePageChange = useCallback(
    (page: number) => {
      setTranslationUnit(pdfUnitKey(page));
      lastPositionWriteRef.current =
        window.readlynx?.db.updateReadingState(bookId, { currentPage: page }) ?? null;
    },
    [bookId, setTranslationUnit],
  );

  const handleChapterChange = useCallback(
    (chapterKey: string) => {
      prevEpubChapterRef.current = chapterKey;
      setTranslationUnit(epubUnitKey(chapterKey));
      // New chapter just rendered: restore its own saved position (if any).
      // Each chapter keeps an independent offset — never copied from another
      // chapter or from the translation.
      const saved = loadScrollRatio("epub-orig", bookId, chapterKey);
      if (saved !== null && saved > 0) {
        let left = 6;
        const tick = () => {
          const scroll = epubRef.current?.getChapterScroll();
          if (scroll && scroll.max > 0) {
            epubRef.current?.setChapterScroll(saved * scroll.max);
            left -= 1;
            if (left > 0) window.setTimeout(() => requestAnimationFrame(tick), 150);
            return;
          }
          left -= 1;
          if (left > 0) window.setTimeout(() => requestAnimationFrame(tick), 150);
        };
        requestAnimationFrame(tick);
      }
      lastPositionWriteRef.current =
        window.readlynx?.db.updateReadingState(bookId, {
          currentChapter: chapterKey,
          progressPercent: epubProgressRef.current,
        }) ?? null;
    },
    [bookId, setTranslationUnit],
  );

  /** Persists the source's totals (`totalPages` for PDF, `totalChapters` for
   *  EPUB) plus the restored EPUB position once the viewer reports it is
   *  ready (onReady fires after the saved chapter was jumped to). */
  const persistTotals = useCallback(() => {
    const db = window.readlynx?.db;
    if (!db) return;
    const pageCount = pdfRef.current?.getPageCount();
    if (pageCount && pageCount > 0) {
      setPageCount(pageCount);
      void db.updateReadingState(bookId, { totalPages: pageCount });
    }
    const chapterCount = epubRef.current?.getChapterCount();
    if (chapterCount && chapterCount > 0) {
      setChapterCount(chapterCount);
      void db.updateReadingState(bookId, { totalChapters: chapterCount });
    }
    const progress = epubProgressRef.current;
    if (progress > 0) {
      void db.updateReadingState(bookId, { progressPercent: Math.min(1, progress) });
    }
  }, [bookId]);

  /** Persists the visible long-document scroll positions (EPUB / Markdown,
   *  original + translation independently) — localStorage is synchronous, so
   *  this is safe to call during close/unmount. */
  const flushScrollMemory = useCallback(() => {
    try {
      const sourceType = readyBook?.sourceType;
      if (sourceType === "epub") {
        const scroll = epubRef.current?.getChapterScroll();
        const chapter = translation.unitKey
          ? unitToChapter(translation.unitKey)
          : prevEpubChapterRef.current;
        if (scroll && scroll.max > 0 && chapter) {
          saveScrollRatio("epub-orig", bookId, chapter, scroll.top / scroll.max);
        }
        const unitKey = translation.unitKey;
        if (unitKey) {
          const ratio = markdownRatio(translationScrollRef.current);
          if (ratio !== null) saveScrollRatio("trans", bookId, unitKey, ratio);
        }
      } else if (sourceType === "markdown") {
        const origRatio = markdownRatio(originalMarkdownScrollRef.current);
        if (origRatio !== null) saveScrollRatio("md-orig", bookId, "doc", origRatio);
        const unitKey = translation.unitKey;
        if (unitKey) {
          const ratio = markdownRatio(translationScrollRef.current);
          if (ratio !== null) saveScrollRatio("trans", bookId, unitKey, ratio);
        }
      }
    } catch {
      // best-effort only
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [readyBook, bookId, translation.unitKey]);

  /** Closing the app waits for the last position write and the session
   *  flush, the same saves the back button's close performs. */
  useCloseFlush(async () => {
    flushScrollMemory();
    await lastPositionWriteRef.current;
    await flushSession();
  });

  /** Latest scroll saver, mirrored into a ref so the unmount cleanup below
   *  can stay unmount-only. `flushScrollMemory` gets a new identity on every
   *  page/chapter turn (it closes over `translation.unitKey`) — listing it in
   *  the cleanup's deps would run `flushSession()` on every turn, and the
   *  first run permanently closes the session (`timeFlushedRef`), freezing
   *  the daily-minutes counter (usually at 0m). */
  const flushScrollMemoryRef = useRef(flushScrollMemory);
  useEffect(() => {
    flushScrollMemoryRef.current = flushScrollMemory;
  });

  /** Leaving the page (sidebar navigation, back) without going through the
   *  back button still counts the session and saves the last EPUB position.
   *  Unmount-only: see `flushScrollMemoryRef` above. */
  useEffect(() => {
    return () => {
      flushScrollMemoryRef.current();
      void flushSession();
      const progress = epubProgressRef.current;
      if (progress > 0) {
        void window.readlynx?.db.updateReadingState(bookId, {
          progressPercent: Math.min(1, progress),
        });
      }
    };
  }, [flushSession, bookId]);

  /** PDF click-to-ask: follows the translate panel's top setting — OCR the
   *  whole current page locally and seed the chat with the recognized text
   *  (opening the panel in a busy state meanwhile), or hand the page image
   *  straight to a vision model. */
  const handleAskPdfRegion = useCallback(
    async ({ image }: { image: string }) => {
      setChatError(null);
      if (methodFor(readyBook?.sourceType ?? "pdf", translation.pdfMethod) === "ocr") {
        askPdfRef.current = true;
        setPdfAskBusy(true);
        try {
          const result = await window.readlynx?.ocr.recognize({
            dataUrl: image,
            langs: translation.settings.ocrLangs,
          });
          if (!askPdfRef.current) return;
          const text = (result?.text ?? "").trim();
          if (!text) {
            setChatError(
              "No text detected on this page. Try zooming in, or switch the top setting to AI vision.",
            );
            return;
          }
          setAiContext(text);
        } catch (err) {
          if (!askPdfRef.current) return;
          setChatError(err instanceof Error ? err.message : String(err));
        } finally {
          askPdfRef.current = false;
          setPdfAskBusy(false);
        }
      } else {
        setPdfAskImages([image]);
      }
    },
    [readyBook?.sourceType, translation.pdfMethod, translation.settings],
  );

  const book = state.status === "ready" ? state.book : null;
  const showTranslation = translation.viewMode === "translation";

  /** Saves the EPUB original scroll for a chapter as a 0..1 ratio. */
  const saveEpubScroll = useCallback(
    (chapterKey: string | null | undefined) => {
      if (book?.sourceType !== "epub" || !chapterKey) return;
      const scroll = epubRef.current?.getChapterScroll();
      if (!scroll || scroll.max <= 0) return;
      saveScrollRatio("epub-orig", bookId, chapterKey, scroll.top / scroll.max);
    },
    [book?.sourceType, bookId],
  );

  /** Saves the translation scroll for a unit as a 0..1 ratio. */
  const saveTranslationScroll = useCallback(
    (unitKey: string | null | undefined) => {
      if (!unitKey) return;
      if (book?.sourceType === "pdf") return;
      const ratio = markdownRatio(translationScrollRef.current);
      if (ratio === null) return;
      saveScrollRatio("trans", bookId, unitKey, ratio);
    },
    [book?.sourceType, bookId],
  );

  /** Saves the original Markdown scroll (markdown books: single document). */
  const saveMdOriginalScroll = useCallback(() => {
    if (book?.sourceType !== "markdown") return;
    const ratio = markdownRatio(originalMarkdownScrollRef.current);
    if (ratio === null) return;
    saveScrollRatio("md-orig", bookId, "doc", ratio);
  }, [book?.sourceType, bookId]);

  /** Queues a debounced save of whichever long-document view is visible. */
  const scheduleScrollSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      if (book?.sourceType === "epub") {
        if (showTranslation) saveTranslationScroll(translation.unitKey);
        else {
          const chapter = translation.unitKey
            ? unitToChapter(translation.unitKey)
            : prevEpubChapterRef.current;
          saveEpubScroll(chapter ?? prevEpubChapterRef.current);
        }
      } else if (book?.sourceType === "markdown") {
        if (showTranslation) saveTranslationScroll(translation.unitKey);
        else saveMdOriginalScroll();
      }
    }, 300);
  }, [
    book?.sourceType,
    showTranslation,
    translation.unitKey,
    saveTranslationScroll,
    saveEpubScroll,
    saveMdOriginalScroll,
  ]);

  /** Switching keeps each view where it was: persist the outgoing view only.
   *  Nothing is copied across, so there is no jump. The translation Markdown
   *  unmounts while hidden, so its restored-marker is cleared on leave —
   *  otherwise coming back to the same unit would skip the restore and the
   *  view would reset to the top. */
  const toggleViewMode = useCallback(() => {
    const nextMode = showTranslation ? "original" : "translation";
    if (book?.sourceType === "epub") {
      if (showTranslation) {
        saveTranslationScroll(translation.unitKey);
        if (translation.unitKey) restoredUnitsRef.current.delete(`trans:${translation.unitKey}`);
      } else {
        const chapter = translation.unitKey
          ? unitToChapter(translation.unitKey)
          : prevEpubChapterRef.current;
        saveEpubScroll(chapter ?? prevEpubChapterRef.current);
      }
    } else if (book?.sourceType === "markdown") {
      if (showTranslation) {
        saveTranslationScroll(translation.unitKey);
        if (translation.unitKey) restoredUnitsRef.current.delete(`trans:${translation.unitKey}`);
      } else saveMdOriginalScroll();
    }
    translation.setViewMode(nextMode);
  }, [
    book?.sourceType,
    showTranslation,
    translation,
    saveTranslationScroll,
    saveEpubScroll,
    saveMdOriginalScroll,
  ]);

  /** Restores the translation scroll once its content for the current unit is
   *  ready. Once per unit per view-session, so later re-renders (zoom,
   *  images) never snap the user back. The marker is cleared when leaving
   *  the translation view (see toggleViewMode) because the Markdown host
   *  unmounts — otherwise returning to the same unit would skip the restore
   *  and reset to the top. */
  useEffect(() => {
    if (!showTranslation) return;
    if (book?.sourceType === "pdf") return;
    const unitKey = translation.unitKey;
    if (!unitKey) return;
    if (!translation.markdown || translation.markdownLoading || translation.imagesPending) return;
    const element = translationScrollRef.current;
    if (!element) return;
    if (prevTransUnitRef.current === unitKey && restoredUnitsRef.current.has(`trans:${unitKey}`)) {
      return;
    }
    prevTransUnitRef.current = unitKey;
    restoredUnitsRef.current.add(`trans:${unitKey}`);
    const saved = loadScrollRatio("trans", bookId, unitKey);
    if (saved !== null && saved > 0) {
      restoreMarkdownRatio(element, saved);
    }
  }, [
    showTranslation,
    book?.sourceType,
    bookId,
    translation.unitKey,
    translation.markdown,
    translation.markdownLoading,
    translation.imagesPending,
  ]);

  /** Restores the original Markdown scroll once the file text is loaded. */
  useEffect(() => {
    if (showTranslation) return;
    if (book?.sourceType !== "markdown") return;
    if (!markdownSource) return;
    const key = "md-orig:doc";
    if (restoredUnitsRef.current.has(key)) return;
    restoredUnitsRef.current.add(key);
    const saved = loadScrollRatio("md-orig", bookId, "doc");
    if (saved !== null && saved > 0) {
      restoreMarkdownRatio(originalMarkdownScrollRef.current, saved);
    }
  }, [showTranslation, book?.sourceType, bookId, markdownSource]);

  /** Continuously persists the visible Markdown view while scrolling
   *  (debounced). EPUB original is polled below — its scroll element lives
   *  inside the viewer's iframe/container. */
  useEffect(() => {
    const target = showTranslation
      ? translationScrollRef.current
      : originalMarkdownScrollRef.current;
    if (!target) return;
    if (book?.sourceType !== "epub" && book?.sourceType !== "markdown") return;
    // EPUB translation also scrolls a Markdown host.
    if (!showTranslation && book?.sourceType !== "markdown") return;
    const onScroll = () => scheduleScrollSave();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [
    showTranslation,
    book?.sourceType,
    translation.unitKey,
    translation.markdown,
    markdownSource,
    scheduleScrollSave,
  ]);

  /** Polls the EPUB original scroll while it is visible (its scroll element
   *  is owned by the viewer, so a direct listener would miss iframe scrolls). */
  useEffect(() => {
    if (book?.sourceType !== "epub" || showTranslation) return;
    const id = window.setInterval(() => {
      const chapter = translation.unitKey
        ? unitToChapter(translation.unitKey)
        : prevEpubChapterRef.current;
      saveEpubScroll(chapter ?? prevEpubChapterRef.current);
    }, 2000);
    return () => window.clearInterval(id);
  }, [book?.sourceType, showTranslation, translation.unitKey, saveEpubScroll]);

  /** Reader-mode navigation: which unit the translation view is showing and
   *  prev/next movement through the document (PDF pages / EPUB chapters).
   *  Markdown books are a single document — no prev/next navigation.
   *  Only shown inside the Markdown viewer's toolbar — the Markdown component
   *  itself stays source-agnostic via its `toolbarExtra` slot. */
  const currentPdfPage =
    book?.sourceType === "pdf" ? unitToPage(translation.unitKey ?? pdfUnitKey(1)) : null;
  const currentChapter =
    book?.sourceType === "epub"
      ? Number(unitToChapter(translation.unitKey ?? epubUnitKey("0")))
      : null;
  const isMarkdownBook = book?.sourceType === "markdown";
  // Fall back to the viewer's live count when state hasn't been persisted yet
  // (e.g. right after load) so the nav buttons are not stuck disabled.
  const totalPages = pageCount || pdfRef.current?.getPageCount() || 0;
  const totalChapters = chapterCount || epubRef.current?.getChapterCount() || 0;
  const canPrev = isMarkdownBook
    ? false
    : book?.sourceType === "pdf"
      ? (currentPdfPage ?? 1) > 1
      : (currentChapter ?? 0) > 0;
  const canNext = isMarkdownBook
    ? false
    : book?.sourceType === "pdf"
      ? totalPages === 0
        ? false
        : (currentPdfPage ?? 1) < totalPages
      : totalChapters === 0
        ? false
        : (currentChapter ?? 0) + 1 < totalChapters;
  const goUnit = useCallback(
    (delta: number) => {
      if (!book || book.sourceType === "markdown") return;
      if (book.sourceType === "pdf") {
        pdfRef.current?.goToPage((currentPdfPage ?? 1) + delta);
      } else {
        // Persist the current chapter/unit scroll before leaving it, so
        // coming back restores the same spot. `onChapterChange` restores
        // the target chapter after `rendition.display()`.
        if (showTranslation) saveTranslationScroll(translation.unitKey);
        else {
          const chapter = translation.unitKey
            ? unitToChapter(translation.unitKey)
            : prevEpubChapterRef.current;
          saveEpubScroll(chapter ?? prevEpubChapterRef.current);
        }
        // Mirror PDF: drive the viewer — it fires `onChapterChange` which
        // updates `translation.unitKey` and loads the chapter's markdown.
        // The viewer stays layout-capable while hidden (see .viewerHidden)
        // so `rendition.display()` still triggers `relocated` like PDF's
        // state update does.
        const next = (currentChapter ?? 0) + delta;
        const clamped =
          totalChapters > 0 ? Math.min(Math.max(0, next), totalChapters - 1) : Math.max(0, next);
        const viewer = epubRef.current;
        if (viewer) {
          viewer.goToChapter(clamped);
        } else {
          const fallback = String(Math.max(0, next));
          setTranslationUnit(epubUnitKey(fallback));
          void window.readlynx?.db.updateReadingState(bookId, {
            currentChapter: fallback,
            progressPercent: epubProgressRef.current,
          });
        }
      }
    },
    [
      book,
      bookId,
      currentPdfPage,
      currentChapter,
      totalChapters,
      setTranslationUnit,
      showTranslation,
      translation.unitKey,
      saveTranslationScroll,
      saveEpubScroll,
    ],
  );
  const toolbarExtra =
    showTranslation && book && !isMarkdownBook ? (
      <div className={styles.navExtra}>
        <Button
          variant="ghost"
          className={styles.navButton}
          onClick={() => goUnit(-1)}
          disabled={!canPrev}
          aria-label="Previous page or chapter"
          title="Previous page/chapter"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
        <span className={styles.navLabel}>
          {book.sourceType === "pdf"
            ? `Page ${currentPdfPage ?? 1} / ${totalPages || "…"}`
            : `Chapter ${(currentChapter ?? 0) + 1} / ${totalChapters || "…"}`}
        </span>
        <Button
          variant="ghost"
          className={styles.navButton}
          onClick={() => goUnit(1)}
          disabled={!canNext}
          aria-label="Next page or chapter"
          title="Next page/chapter"
        >
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
    ) : undefined;

  /** Arrow keys navigate prev/next page or chapter (same movement as the
   *  toolbar nav strip), in both the original viewer and the translation
   *  view. Ignored inside form controls, while a dialog is open, or with
   *  modifier keys. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (!book) return;
      if (event.key === "ArrowLeft" && canPrev) {
        event.preventDefault();
        goUnit(-1);
      } else if (event.key === "ArrowRight" && canNext) {
        event.preventDefault();
        goUnit(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [book, canPrev, canNext, goUnit]);

  return (
    <main className={styles.page} aria-label="Reading book">
      <header className={`${styles.topBar} animate-fade-up`}>
        <Button
          variant="icon"
          className={styles.backButton}
          aria-label="Back to home"
          onClick={() => {
            flushScrollMemory();
            void flushSession();
            onBack?.();
          }}
        >
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>

        <div className={styles.titleGroup}>
          {book ? (
            <>
              <span className={styles.kindBadge} aria-hidden="true">
                <BookOpen size={13} strokeWidth={2} />
              </span>
              <h1 className={styles.title}>{book.title}</h1>
            </>
          ) : (
            <h1 className={styles.title}>Reading book</h1>
          )}
        </div>

        {book && (
          <TranslationSettingsPanel
            sourceType={book.sourceType}
            models={translation.models}
            modelsError={translation.modelsError}
            modelIds={translation.settings.modelIds}
            onModelIdsChange={(ids) => translation.updateSettings({ modelIds: ids })}
            pdfMethod={translation.pdfMethod}
            onPdfMethodChange={translation.setPdfMethod}
            settings={translation.settings}
            onSettingsChange={translation.updateSettings}
            onInstructionEdited={translation.refreshCustomPrompt}
            busy={translation.busy}
            status={translation.status}
            error={translation.error}
            hasTranslation={translation.hasTranslation}
            installed={translation.installed}
            downloading={translation.downloading}
            downloadProgress={translation.downloadProgress}
            onDownload={translation.downloadModel}
            onDelete={translation.deleteModel}
            pageCount={pageCount}
            progress={translation.rangeProgress}
            onTranslate={() => void translation.translate(false)}
            onRegenerate={translation.regenerate}
            onTranslateRange={translation.translateRange}
            onCancel={translation.cancelTranslation}
            rateLimitRetry={translation.rateLimitRetry}
          />
        )}
      </header>

      <div className={styles.viewerArea}>
        {state.status === "loading" ? (
          <div className={styles.state} aria-label="Loading book">
            <Loader2 size={24} strokeWidth={2} className={styles.spinner} />
            <span>Loading book…</span>
          </div>
        ) : state.status === "error" ? (
          <div className={styles.state} role="alert">
            <FileWarning size={28} strokeWidth={1.8} aria-hidden="true" />
            <span>{state.message}</span>
          </div>
        ) : state.status === "ready" ? (
          <>
            <div className={showTranslation ? styles.viewerHidden : styles.viewerStage}>
              {state.book.sourceType === "pdf" ? (
                <PdfViewer
                  ref={pdfRef}
                  filePath={state.book.filePath}
                  fill
                  toolbar
                  fitWidth
                  className={styles.viewer}
                  themeBookId={bookId}
                  initialPage={savedPage}
                  onReady={persistTotals}
                  onPageChange={handlePageChange}
                  onAskAi={handleAskPdfRegion}
                />
              ) : state.book.sourceType === "epub" ? (
                <EpubViewer
                  ref={epubRef}
                  filePath={state.book.filePath}
                  fill
                  toolbar
                  showExtract={false}
                  settingsBookId={bookId}
                  initialChapter={savedChapter}
                  className={styles.viewer}
                  onReady={() => {
                    persistTotals();
                    setEpubReady(true);
                  }}
                  onChapterChange={handleChapterChange}
                  onProgressChange={(progress) => {
                    epubProgressRef.current = progress;
                    // The EPUB renders inside an iframe, whose interactions
                    // never reach the page-level activity listeners — a
                    // position update proves the user is reading and keeps
                    // the session from idling out.
                    onActivity();
                  }}
                  onAskAi={setAiContext}
                />
              ) : markdownSourceError ? (
                <div className={styles.state} role="alert">
                  <FileWarning size={28} strokeWidth={1.8} aria-hidden="true" />
                  <span>{markdownSourceError}</span>
                </div>
              ) : markdownSource === null ? (
                <div className={styles.state} aria-label="Loading Markdown">
                  <Loader2 size={24} strokeWidth={2} className={styles.spinner} />
                  <span>Loading Markdown…</span>
                </div>
              ) : (
                <Markdown
                  content={markdownSource}
                  toolbar
                  settingsBookId={bookId}
                  className={styles.translationBody}
                  onAskAi={setAiContext}
                  scrollHostRef={originalMarkdownScrollRef}
                />
              )}
            </div>

            {showTranslation && (
              <div className={styles.translationStage}>
                {translation.markdown ? (
                  <>
                    <Markdown content={translation.markdown} toolbar rawHtml={false} settingsBookId={bookId} className={styles.translationBody} onAskAi={setAiContext} toolbarExtra={toolbarExtra} scrollHostRef={translationScrollRef} />
                    {(translation.markdownLoading || translation.imagesPending) && (
                      <div className={styles.markdownLoading} role="status" aria-label="Loading translation">
                        <Loader2 size={20} strokeWidth={2} className={styles.spinner} />
                      </div>
                    )}
                  </>
                ) : translation.busy ? (
                  <div className={styles.state} aria-label="Translating">
                    <Loader2 size={24} strokeWidth={2} className={styles.spinner} />
                    <span>{translation.status ?? "Translating…"}</span>
                  </div>
                ) : !translation.cacheReady || translation.imagesPending ? (
                  <div className={styles.state} aria-label="Loading translation">
                    <Loader2 size={24} strokeWidth={2} className={styles.spinner} />
                    <span>Loading translation…</span>
                  </div>
                ) : translation.error ? (
                  <div className={styles.state} role="alert">
                    <FileWarning size={28} strokeWidth={1.8} aria-hidden="true" />
                    <span>{translation.error}</span>
                    <span className={styles.stateHint}>
                      Open the Translate panel to retry, or switch back to the original.
                    </span>
                  </div>
                ) : (
                  <div className={styles.state}>
                    <Languages size={28} strokeWidth={1.6} aria-hidden="true" />
                    <span>
                      No translation yet for this{" "}
                      {state.book.sourceType === "pdf"
                        ? "page"
                        : state.book.sourceType === "markdown"
                          ? "document"
                          : "chapter"}
                      .
                    </span>
                    <span className={styles.stateHint}>
                      Open the Translate panel and press Translate.
                    </span>
                  </div>
                )}
              </div>
            )}

            <TranslationToggle
              active={showTranslation}
              onClick={toggleViewMode}
            />
          </>
        ) : null}
      </div>

      <AiChatPanel
        open={
          aiContext !== null || pdfAskImages !== null || chatError !== null || pdfAskBusy
        }
        contextText={aiContext}
        contextImages={pdfAskImages ?? undefined}
        initialError={chatError}
        initialBusy={pdfAskBusy}
        initialBusyLabel="Capturing page data…"
        onClose={() => {
          askPdfRef.current = false;
          setAiContext(null);
          setPdfAskImages(null);
          setChatError(null);
          setPdfAskBusy(false);
        }}
      />
    </main>
  );
}
