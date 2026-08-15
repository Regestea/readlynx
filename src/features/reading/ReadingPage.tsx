import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, FileWarning, Languages, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/Button/Button";
import { PdfViewer } from "../../components/pdfViewer/PdfViewer";
import type { PdfViewerHandle } from "../../components/pdfViewer/PdfViewer";
import { EpubViewer } from "../../components/epubViewer/EpubViewer";
import type { EpubViewerHandle } from "../../components/epubViewer/EpubViewer";
import { Markdown } from "../../components/markdown/Markdown";
import { AiChatPanel } from "../../components/aiChat/AiChatPanel";
import type { BookSourceType } from "../../infrastructure/db/entities/types";
import { TranslationSettingsPanel, TranslationToggle } from "./translation/TranslationPanel";
import { useTranslation } from "./translation/useTranslation";
import { epubUnitKey, methodFor, pdfUnitKey, unitToChapter, unitToPage } from "./translation/types";
import { useCloseFlush } from "../../shared/closeFlush";
import styles from "./ReadingPage.module.css";

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
  const [aiContext, setAiContext] = useState<string | null>(null);
  const [pdfAskImages, setPdfAskImages] = useState<string[] | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pdfAskBusy, setPdfAskBusy] = useState(false);
  const askPdfRef = useRef(false);
  const pdfRef = useRef<PdfViewerHandle | null>(null);
  const epubRef = useRef<EpubViewerHandle | null>(null);
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
    void Promise.all([db.getBook(bookId), db.getReadingState(bookId)]).then(([result, reading]) => {
      if (cancelled) return;
      if (!result?.source) {
        setState({ status: "error", message: "This book has no source file to display." });
        return;
      }
      setSavedPage(reading?.currentPage ?? 1);
      setSavedChapter(reading?.currentChapter || null);
      setState({
        status: "ready",
        book: {
          title: result.book.title,
          sourceType: result.source.sourceType === "epub" ? "epub" : "pdf",
          filePath: result.source.filePath,
        },
      });
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
  }, [bookId, tickHeartbeat]);

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
      setTranslationUnit(epubUnitKey(chapterKey));
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

  /** Closing the app waits for the last position write and the session
   *  flush, the same saves the back button's close performs. */
  useCloseFlush(async () => {
    await lastPositionWriteRef.current;
    await flushSession();
  });

  /** Leaving the page (sidebar navigation, back) without going through the
   *  back button still counts the session and saves the last EPUB position. */
  useEffect(() => {
    return () => {
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

  /** Reader-mode navigation: which unit the translation view is showing and
   *  prev/next movement through the document (PDF pages / EPUB chapters).
   *  Only shown inside the Markdown viewer's toolbar — the Markdown component
   *  itself stays source-agnostic via its `toolbarExtra` slot. */
  const currentPdfPage =
    book?.sourceType === "pdf" ? unitToPage(translation.unitKey ?? pdfUnitKey(1)) : null;
  const currentChapter =
    book?.sourceType === "epub"
      ? Number(unitToChapter(translation.unitKey ?? epubUnitKey("0")))
      : null;
  const canPrev = book?.sourceType === "pdf" ? (currentPdfPage ?? 1) > 1 : (currentChapter ?? 0) > 0;
  const canNext =
    book?.sourceType === "pdf"
      ? (currentPdfPage ?? 1) < pageCount
      : (currentChapter ?? 0) + 1 < chapterCount;
  const goUnit = useCallback(
    (delta: number) => {
      if (!book) return;
      if (book.sourceType === "pdf") {
        pdfRef.current?.goToPage((currentPdfPage ?? 1) + delta);
      } else {
        epubRef.current?.goToChapter((currentChapter ?? 0) + delta);
      }
    },
    [book, currentPdfPage, currentChapter, pdfRef, epubRef],
  );
  const toolbarExtra =
    showTranslation && book ? (
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
            ? `Page ${currentPdfPage ?? 1} / ${pageCount || "…"}`
            : `Chapter ${(currentChapter ?? 0) + 1} / ${chapterCount || "…"}`}
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
              ) : (
                <EpubViewer
                  ref={epubRef}
                  filePath={state.book.filePath}
                  fill
                  toolbar
                  showExtract={false}
                  settingsBookId={bookId}
                  initialChapter={savedChapter}
                  className={styles.viewer}
                  onReady={persistTotals}
                  onChapterChange={handleChapterChange}
                  onProgressChange={(progress) => {
                    epubProgressRef.current = progress;
                  }}
                  onAskAi={setAiContext}
                />
              )}
            </div>

            {showTranslation && (
              <div className={styles.translationStage}>
                {translation.markdown ? (
                  <>
                    <Markdown content={translation.markdown} toolbar rawHtml={false} settingsBookId={bookId} className={styles.translationBody} onAskAi={setAiContext} toolbarExtra={toolbarExtra} />
                    {translation.markdownLoading && (
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
                    <span>No translation yet for this {state.book.sourceType === "pdf" ? "page" : "chapter"}.</span>
                    <span className={styles.stateHint}>
                      Open the Translate panel and press Translate.
                    </span>
                  </div>
                )}
              </div>
            )}

            <TranslationToggle
              active={showTranslation}
              onClick={() => translation.setViewMode(showTranslation ? "original" : "translation")}
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
