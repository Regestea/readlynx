import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, FileWarning, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button/Button";
import { PdfViewer } from "../../../components/PdfViewer/PdfViewer";
import { EpubViewer } from "../../../components/EpubViewer/EpubViewer";
import type { BookSourceType } from "../../../db/entities/types";
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

  const book = state.status === "ready" ? state.book : null;

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
            </>
          ) : (
            <h1 className={styles.title}>Reading book</h1>
          )}
        </div>
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
          state.book.sourceType === "pdf" ? (
            <PdfViewer filePath={state.book.filePath} fill toolbar fitWidth className={styles.viewer} />
          ) : (
            <EpubViewer filePath={state.book.filePath} fill toolbar showExtract={false} className={styles.viewer} />
          )
        ) : null}
      </div>
    </main>
  );
}