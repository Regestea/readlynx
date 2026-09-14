import { useCallback, useEffect, useState } from "react";
import { ThemeProvider } from "./providers/theme/ThemeProvider";
import { Header } from "./layout/Header/Header";
import { Sidebar } from "./layout/Sidebar/Sidebar";
import { HomePage } from "../features/home/HomePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { BackupPage } from "../features/backup/BackupPage";
import { CreateBookPage } from "../features/create/CreateBookPage";
import type { CreateBookDetails } from "../features/home/components/CreateBookDialog";
import { PdfCoverCapture } from "../features/home/components/PdfCoverCapture";
import { useExternalFileOpen } from "../features/home/hooks/useExternalFileOpen";
import { ReadingPage } from "../features/reading/ReadingPage";
import type { BookListItem } from "../infrastructure/db/entities";
import { ReadingProgress } from "../features/home/widgets/ReadingProgress/ReadingProgress";
import { WeeklyStats } from "../features/home/widgets/WeeklyStats/WeeklyStats";
import { getCloseFlush } from "../shared/closeFlush";
import styles from "./App.module.css";

export default function App() {
  const [activeId, setActiveId] = useState("home");
  const [createDetails, setCreateDetails] = useState<CreateBookDetails | null>(null);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [readingBookId, setReadingBookId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isHome = activeId === "home";
  const isFullWidth = !isHome;

  /** Shared routing into the read-only reader (home shelf + OS open-with). */
  const openReadingBook = useCallback((bookId: string) => {
    setCreateDetails(null);
    setOpenBookId(null);
    setReadingBookId(bookId);
    setSidebarCollapsed(true);
    setActiveId("reading");
  }, []);

  /** OS "Open with ReadLynx" (double-click on pdf/epub/md): silent import
   *  into the library, then straight to the reader. */
  const { coverJob, clearCoverJob } = useExternalFileOpen(openReadingBook);

  /** When the window is closing, run the active page's save flush first (the
   *  same work its top-bar back button would do), then let the window close. */
  useEffect(() => {
    const unsubscribe = window.readlynx?.onPrepareClose(() => {
      const finish = () => window.readlynx?.notifyReadyToClose();
      const flush = getCloseFlush();
      if (!flush) {
        finish();
        return;
      }
      void flush().then(finish, finish);
    });
    return () => unsubscribe?.();
  }, []);

  /** Native HTTP requests (AI calls, OCR model downloads, …) leave the app
   *  from the main process, so the renderer Network tab can't see them. Mirror
   *  the main-process log lines into this DevTools console instead. */
  useEffect(() => {
    return window.readlynx?.onHttpLog(({ line, body, responseBody }) => {
      // Log the bodies as extra arguments so DevTools renders them as
      // expandable objects instead of one unreadable JSON line.
      const args: unknown[] = [];
      if (body !== undefined) args.push(body);
      if (responseBody !== undefined) args.push(responseBody);
      console.log(`%c${line}`, "color:#5a8dee;font-weight:600", ...args);
    });
  }, []);

  const handleNavigate = (id: string) => {
    if (id !== "create-book") {
      setSidebarCollapsed(false);
    }
    setActiveId(id);
  };

  /** Opens a book from the header search suggestions — same routing as the
   *  home shelf: reading books go to the read-only reader, the rest to the
   *  editor. */
  const handleOpenBookFromSearch = (book: BookListItem) => {
    if (book.kind === "reading") {
      setCreateDetails(null);
      setOpenBookId(null);
      setReadingBookId(book.id);
      setSidebarCollapsed(true);
      setActiveId("reading");
    } else {
      setCreateDetails(null);
      setOpenBookId(book.id);
      setReadingBookId(null);
      setActiveId("create-book");
    }
  };

  return (
    <ThemeProvider>
      <div className="app-background" aria-hidden="true">
        <div className="app-background-layer app-background-layer--day" />
        <div className="app-background-layer app-background-layer--night" />
        <div className="app-background-overlay" />
      </div>

      <div
        className={`${styles.shell} ${isFullWidth ? styles.shellFull : ""} ${sidebarCollapsed ? styles.shellGapNone : ""}`}
      >
        <div
          className={`${styles.sidebarSlide} ${sidebarCollapsed ? styles.sidebarSlideCollapsed : ""}`}
        >
          <div className={styles.sidebarSlideInner}>
            <Sidebar activeId={activeId} onNavigate={handleNavigate} />
          </div>
        </div>

        <div className={styles.main}>
          {isHome && <Header onSelectBook={handleOpenBookFromSearch} />}
          {isHome && (
            <HomePage
              onCreateBook={(details) => {
                setCreateDetails(details);
                setOpenBookId(null);
                setReadingBookId(null);
                setActiveId("create-book");
              }}
              onOpenBook={(bookId) => {
                setCreateDetails(null);
                setOpenBookId(bookId);
                setReadingBookId(null);
                setActiveId("create-book");
              }}
              onOpenReadingBook={openReadingBook}
            />
          )}
          {coverJob && <PdfCoverCapture job={coverJob} onDone={clearCoverJob} />}
          {activeId === "create-book" && (
            <CreateBookPage
              onBack={() => {
                setSidebarCollapsed(false);
                setActiveId("home");
              }}
              initialBookId={openBookId}
              initialTitle={createDetails?.title ?? ""}
              initialMarkdown=""
              initialCover={createDetails?.coverSrc ?? null}
              onSplitChange={setSidebarCollapsed}
            />
          )}
          {activeId === "reading" && readingBookId && (
            <ReadingPage
              key={readingBookId}
              bookId={readingBookId}
              onBack={() => {
                setSidebarCollapsed(false);
                setActiveId("home");
              }}
            />
          )}
          {activeId === "backup" && <BackupPage />}
          {activeId === "settings" && <SettingsPage />}
        </div>

        {isHome && (
          <aside className={styles.panel} aria-label="Reading overview">
            <ReadingProgress />
            <WeeklyStats />
          </aside>
        )}
      </div>
    </ThemeProvider>
  );
}
