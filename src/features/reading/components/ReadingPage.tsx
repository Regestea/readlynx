import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FileWarning, Languages, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button/Button";
import { PdfViewer } from "../../../components/pdfViewer/PdfViewer";
import type { PdfViewerHandle } from "../../../components/pdfViewer/PdfViewer";
import { EpubViewer } from "../../../components/epubViewer/EpubViewer";
import type { EpubViewerHandle } from "../../../components/epubViewer/EpubViewer";
import { Markdown } from "../../../components/markdown/Markdown";
import { AiChatPanel } from "../../../features/reading/aiChat/AiChatPanel";
import type { BookSourceType } from "../../../infrastructure/db/entities/types";
import { TranslationSettingsPanel, TranslationToggle } from "../translation/TranslationPanel";
import { useTranslation } from "../translation/useTranslation";
import { epubUnitKey, methodFor, pdfUnitKey } from "../translation/types";
import styles from "./ReadingPage.module.css";

interface ReadingPageProps {
  bookId: string;
  onBack?: () => void;
}

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
  const [aiContext, setAiContext] = useState<string | null>(null);
  const [pdfAskImages, setPdfAskImages] = useState<string[] | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pdfAskBusy, setPdfAskBusy] = useState(false);
  const askPdfRef = useRef(false);
  const pdfRef = useRef<PdfViewerHandle | null>(null);
  const epubRef = useRef<EpubViewerHandle | null>(null);

  const readyBook = state.status === "ready" ? state.book : null;
  const translation = useTranslation({
    bookId,
    sourceType: readyBook?.sourceType ?? "pdf",
    pdfRef,
    epubRef,
  });
  const { setUnit: setTranslationUnit } = translation;

  useEffect(() => {
    let cancelled = false;
    const db = window.readlynx?.db;
    if (!db) return;
    void db.getBook(bookId).then((result) => {
      if (cancelled) return;
      if (!result?.source) {
        setState({ status: "error", message: "This book has no source file to display." });
        return;
      }
      setState({
        status: "ready",
        book: {
          title: result.book.title,
          sourceType: result.source.sourceType === "epub" ? "epub" : "pdf",
          filePath: result.source.filePath,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const handlePageChange = useCallback(
    (page: number) => {
      setTranslationUnit(pdfUnitKey(page));
    },
    [setTranslationUnit],
  );

  const handleChapterChange = useCallback(
    (chapterKey: string) => {
      setTranslationUnit(epubUnitKey(chapterKey));
    },
    [setTranslationUnit],
  );

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

  return (
    <main className={styles.page} aria-label="Reading book">
      <header className={`${styles.topBar} animate-fade-up`}>
        <Button variant="icon" className={styles.backButton} aria-label="Back to home" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>

        <div className={styles.titleGroup}>
          {book ? (
            <>
              <span className={styles.kindBadge} aria-hidden="true">
                <BookOpen size={13} strokeWidth={2} />
              </span>
              <h1 className={styles.title}>{book.title}</h1>
              <span className={styles.fileBadge}>
                {book.sourceType === "pdf" ? "PDF document" : "EPUB book"}
              </span>
              {showTranslation && (
                <span className={styles.translationBadge}>
                  <Languages size={12} strokeWidth={2} aria-hidden="true" />
                  Translation
                </span>
              )}
            </>
          ) : (
            <h1 className={styles.title}>Reading book</h1>
          )}
        </div>

        {book && (
          <TranslationSettingsPanel
            sourceType={book.sourceType}
            pdfMethod={translation.pdfMethod}
            onPdfMethodChange={translation.setPdfMethod}
            settings={translation.settings}
            onSettingsChange={translation.updateSettings}
            busy={translation.busy}
            status={translation.status}
            error={translation.error}
            hasTranslation={translation.hasTranslation}
            model={translation.model}
            modelsError={translation.modelsError}
            installed={translation.installed}
            downloading={translation.downloading}
            downloadProgress={translation.downloadProgress}
            onDownload={translation.downloadModel}
            onDelete={translation.deleteModel}
            onRefreshModels={translation.refreshModels}
            onTranslate={() => void translation.translate(false)}
            onRegenerate={translation.regenerate}
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
settingsKey={`${bookId}:epub`}
                  className={styles.viewer}
                  onChapterChange={handleChapterChange}
                  onAskAi={setAiContext}
                />
              )}
            </div>

            {showTranslation && (
              <div className={styles.translationStage}>
                {translation.markdown ? (
                  <Markdown content={translation.markdown} toolbar rawHtml={false} settingsKey={`${bookId}:markdown`} className={styles.translationBody} onAskAi={setAiContext} />
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
