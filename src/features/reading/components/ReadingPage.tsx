import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FileWarning, Languages, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button/Button";
import { PdfViewer } from "../../../components/PdfViewer/PdfViewer";
import type { PdfViewerHandle } from "../../../components/PdfViewer/PdfViewer";
import { EpubViewer } from "../../../components/EpubViewer/EpubViewer";
import type { EpubViewerHandle } from "../../../components/EpubViewer/EpubViewer";
import { Markdown } from "../../../components/ui/Markdown/Markdown";
import type { BookSourceType } from "../../../db/entities/types";
import { TranslationSettingsPanel, TranslationToggle } from "../translation/TranslationPanel";
import { useTranslation } from "../translation/useTranslation";
import { epubUnitKey, pdfUnitKey } from "../translation/types";
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
                />
              ) : (
                <EpubViewer
                  ref={epubRef}
                  filePath={state.book.filePath}
                  fill
                  toolbar
                  showExtract={false}
                  className={styles.viewer}
                  onChapterChange={handleChapterChange}
                />
              )}
            </div>

            {showTranslation && (
              <div className={styles.translationStage}>
                {translation.markdown ? (
                  <Markdown content={translation.markdown} toolbar rawHtml={false} className={styles.translationBody} />
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
    </main>
  );
}
