import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "./providers/theme/ThemeProvider";
import { ThemeColorResetGuard } from "./providers/theme/ThemeColorResetGuard";
import { ToastProvider } from "../components/ui/Toast/ToastProvider";
import { Header } from "./layout/Header/Header";
import { Sidebar } from "./layout/Sidebar/Sidebar";
import { TitleBar } from "./layout/TitleBar/TitleBar";
import { HomePage } from "../features/home/HomePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { BackupPage } from "../features/backup/BackupPage";
import { CreateBookPage } from "../features/create/CreateBookPage";
import type { CreateBookDetails } from "../features/home/components/CreateBookDialog";
import { PdfCoverCapture } from "../features/home/components/PdfCoverCapture";
import { useExternalFileOpen } from "../features/home/hooks/useExternalFileOpen";
import { ReadingPage } from "../features/reading/ReadingPage";
import type { BookListItem } from "../infrastructure/db/entities/types";
import { ReadingProgress } from "../features/home/widgets/ReadingProgress/ReadingProgress";
import { WeeklyStats } from "../features/home/widgets/WeeklyStats/WeeklyStats";
import { UpdaterProvider } from "../features/updater/UpdaterProvider";
import { getCloseFlushes } from "../shared/closeFlush";
import { OpenModeDialog } from "../components/ui/OpenModeDialog/OpenModeDialog";
import type { OpenMode } from "../components/ui/OpenModeDialog/OpenModeDialog";
import { HOME_TAB, createTabId, readingTabId, useTabs } from "./tabs";
import type { LibrarySection, Tab } from "./tabs";
import styles from "./App.module.css";

/** A window opened for one book: the reader alone, no sidebar and no tabs, so
 *  it can sit beside the shell instead of sharing its renderer with it. */
function ReaderWindow({ bookId }: { bookId: string }) {
  return (
    <div className={styles.frame}>
      <TitleBar tabs={[]} activeId="" label="ReadLynx" />
      <div className={styles.readerStage}>
        {/* Back has nowhere to go in a window of its own, so it closes the
            window — after the reader has flushed its position, as usual. */}
        <ReadingPage bookId={bookId} onBack={() => void window.readlynx?.windowControls?.close()} />
      </div>
    </div>
  );
}

export default function App() {
  /** What this window is for. `null` until the main process answers — a reader
   *  window must not paint the shell on the way there. With no bridge at all
   *  (a plain browser) there is nothing to ask and it is the shell. */
  const [windowRole, setWindowRole] = useState<"main" | "reader" | null>(() =>
    window.readlynx?.windowControls ? null : "main",
  );
  const [readerBookId, setReaderBookId] = useState<string | null>(null);

  const { tabs, activeTab, activeId, openTab, activateTab, closeTab, renameTab, moveTab } = useTabs();
  /** Set by the editor when it goes split, which wants the sidebar out of the
   *  way. Every other tab derives its own width from its kind. */
  const [editorSplit, setEditorSplit] = useState(false);
  /** The file an external open is waiting on an answer for. */
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  /** Which section of the library tab the sidebar points at. Kept here rather
   *  than as tabs of its own — see `handleNavigate`. */
  const [section, setSection] = useState<LibrarySection>("library");
  const openPromptAnswer = useRef<((mode: OpenMode) => void) | null>(null);

  useEffect(() => {
    const controls = window.readlynx?.windowControls;
    if (!controls) return;
    let cancelled = false;
    void controls
      .getContext()
      .then((context) => {
        if (cancelled) return;
        setWindowRole(context.role);
        setReaderBookId(context.bookId);
      })
      .catch(() => {
        if (!cancelled) setWindowRole("main");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Opens a book in its own window. The main process focuses one already
   *  showing it rather than stacking a second copy. */
  const openBookInWindow = useCallback((bookId: string) => {
    void window.readlynx?.windowControls?.openBook(bookId).catch(() => false);
  }, []);

  /** Suspends `useExternalFileOpen` on a promise the dialog settles. Kept in a
   *  ref so the handler object can change without re-registering the listener. */
  const askOpenMode = useCallback(
    (fileName: string) =>
      new Promise<OpenMode>((resolve) => {
        openPromptAnswer.current = resolve;
        setOpenPrompt(fileName);
      }),
    [],
  );

  const chooseOpenMode = useCallback((mode: OpenMode) => {
    setOpenPrompt(null);
    const answer = openPromptAnswer.current;
    openPromptAnswer.current = null;
    answer?.(mode);
  }, []);

  const isHome = activeTab.kind === "home";
  /** Only the library itself wears the wide sidebar/stats layout. Settings and
   *  Backup & Restore take the whole width, exactly as they did when each was
   *  its own page, so switching sections changes nothing about the frame. */
  const isLibrary = isHome && section === "library";
  /** The sidebar highlights the section on show, not the tab hosting it —
   *  otherwise Settings would light up while the library tab is in front. */
  const sidebarActiveId = isHome ? (section === "library" ? "home" : section) : activeTab.id;
  /** The reader always wants the whole width; the editor only gives up the
   *  sidebar when it goes split, and reports that itself through
   *  `onSplitChange`. Gating on the active kind makes the flag forget itself
   *  when another tab is opened, rather than leaving the editor's last report
   *  to collapse the sidebar on an unrelated page. */
  const sidebarCollapsed =
    activeTab.kind === "reading" || (activeTab.kind === "create" && editorSplit);

  /** Shared routing into the read-only reader (home shelf + OS open-with). */
  const openReadingBook = useCallback(
    (bookId: string) => {
      openTab({ id: readingTabId(bookId), kind: "reading", bookId, title: "Loading…" });
    },
    [openTab],
  );

  /** The editor for an existing book, or a fresh draft seeded from the create
   *  dialog. A draft has no book id yet, so it shares a single tab. */
  const openCreateBook = useCallback(
    (bookId: string | null, details: CreateBookDetails | null) => {
      openTab({
        id: createTabId(bookId),
        kind: "create",
        bookId,
        details,
        title: details?.title || "Untitled",
      });
    },
    [openTab],
  );

  /** OS "Open with ReadLynx" (double-click on pdf/epub/md): import into the
   *  library, then place the book where the user said. Only the shell owns
   *  this hook — a reader window has no tabs to add to and no library. */
  const { coverJob, clearCoverJob } = useExternalFileOpen({
    enabled: windowRole !== "reader",
    askOpenMode,
    onOpenTab: openReadingBook,
    onOpenWindow: openBookInWindow,
  });

  /** Sidebar navigation points the library tab at a section rather than opening
   *  one. Settings and Backup & Restore are not documents: giving them a tab
   *  each would fill the bar with entries nobody closes. */
  const handleNavigate = useCallback(
    (id: string) => {
      const section: LibrarySection = id === "settings" ? "settings" : id === "backup" ? "backup" : "library";
      setSection(section);
      // Coming from a book tab, the sidebar must take the user somewhere the
      // section is actually on show.
      activateTab(HOME_TAB.id);
    },
    [activateTab],
  );

  /** Opens a book from the header search suggestions — same routing as the
   *  home shelf: reading books go to the read-only reader, the rest to the
   *  editor. */
  const handleOpenBookFromSearch = useCallback(
    (book: BookListItem) => {
      if (book.kind === "reading") openReadingBook(book.id);
      else openCreateBook(book.id, null);
    },
    [openCreateBook, openReadingBook],
  );

  /** A reader replaces its placeholder label once the book has loaded. */
  const handleTabTitle = useCallback(
    (id: string, title: string) => renameTab(id, title),
    [renameTab],
  );

  /** A page's back button returns to the library *and* dismisses the tab it
   *  was in. Both pages have already written their last reading position /
   *  document save by the time they call this, so nothing is lost by dropping
   *  the tab — and leaving it in the bar would let the same book be opened
   *  twice. The close on its own hands focus to a neighbour; activating the
   *  library straight after wins, because both updates run through the same
   *  reducer queue in one commit. */
  const backToLibrary = useCallback(
    (id: string) => {
      closeTab(id);
      activateTab(HOME_TAB.id);
    },
    [activateTab, closeTab],
  );

  /** Tab keyboard shortcuts. `Ctrl+W` would close the window outright and
   *  `Ctrl+Tab` does nothing without a menu, so both are ours. `Ctrl+T` is the
   *  nearest thing this app has to a new tab: the library, where a book gets
   *  opened. `Ctrl+W` on the last tab falls through to the window closing,
   *  which is what every tabbed app does. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        activateTab(HOME_TAB.id);
        return;
      }
      if (key === "w" && activeId !== HOME_TAB.id) {
        event.preventDefault();
        closeTab(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, activateTab, closeTab]);

  /** When the window is closing, run the active page's save flush first (the
   *  same work its top-bar back button would do), then let the window close.
   *  Every registered page flushes, not just the frontmost one — a reader
   *  behind another tab still has unsaved reading position to write. */
  useEffect(() => {
    const unsubscribe = window.readlynx?.onPrepareClose(() => {
      const finish = () => window.readlynx?.notifyReadyToClose();
      const flushes = getCloseFlushes();
      if (flushes.length === 0) {
        finish();
        return;
      }
      // `allSettled` never rejects, so one failing save cannot keep the window
      // open; the main process also gives up waiting after a few seconds.
      void Promise.allSettled(flushes.map((flush) => flush())).then(finish, finish);
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

  const renderTab = (tab: Tab) => {
    switch (tab.kind) {
      case "home":
        // The library tab hosts whichever section the sidebar points at. The
        // header and the stats panel belong to the library alone — Settings
        // and Backup & Restore have always been shown without them.
        if (section === "settings") return <SettingsPage />;
        if (section === "backup") return <BackupPage />;
        return (
          <>
            <Header onSelectBook={handleOpenBookFromSearch} />
            <HomePage
              onCreateBook={(details) => openCreateBook(null, details)}
              onOpenBook={(bookId) => openCreateBook(bookId, null)}
              onOpenReadingBook={openReadingBook}
              onOpenBookInWindow={openBookInWindow}
            />
          </>
        );
      case "reading":
        return (
          <ReadingPage
            bookId={tab.bookId}
            active={tab.id === activeId}
            onTitleChange={(title) => handleTabTitle(tab.id, title)}
            onBack={() => backToLibrary(tab.id)}
          />
        );
      case "create":
        return (
          <CreateBookPage
            initialBookId={tab.bookId}
            initialTitle={tab.details?.title ?? ""}
            initialMarkdown=""
            initialCover={tab.details?.coverSrc ?? null}
            onBack={() => backToLibrary(tab.id)}
            onSplitChange={setEditorSplit}
          />
        );
      default:
        return null;
    }
  };

  /** Dragging a book tab off the strip opens it in its own window. Only books
   *  can go: a reader window shows one book, and an editor tab has unsaved
   *  state that has nowhere to travel to. */
  const handleDetach = useCallback(
    (tab: Tab) => {
      if (tab.kind !== "reading") return;
      openBookInWindow(tab.bookId);
    },
    [openBookInWindow],
  );

  return (
    <ThemeProvider>
      <ToastProvider>
        <UpdaterProvider>
          <div className="app-background" aria-hidden="true">
            <div className="app-background-layer app-background-layer--day" />
            <div className="app-background-layer app-background-layer--night" />
            <div className="app-background-overlay" />
          </div>

          {/* Nothing is painted until the window knows what it is: a reader
              window would otherwise show the whole shell for a frame and then
              swap to a single book. */}
          {windowRole === null ? null : windowRole === "reader" && readerBookId ? (
            <ReaderWindow bookId={readerBookId} />
          ) : (
          <div className={styles.frame}>
            <TitleBar
              tabs={tabs}
              activeId={activeId}
              onActivate={activateTab}
              onClose={closeTab}
              onMove={moveTab}
              onDetach={handleDetach}
            />

            <div
              className={`${styles.shell} ${isLibrary ? "" : styles.shellFull} ${sidebarCollapsed ? styles.shellGapNone : ""}`}
            >
              <div
                className={`${styles.sidebarSlide} ${sidebarCollapsed ? styles.sidebarSlideCollapsed : ""}`}
              >
                <div className={styles.sidebarSlideInner}>
                  <Sidebar activeId={sidebarActiveId} onNavigate={handleNavigate} />
                </div>
              </div>

              {/* Every tab stays mounted: the reader holds a loaded PDF, a
                  scroll offset and a translation cache that a remount would
                  throw away. Background panels are hidden and `inert`, so they
                  keep their state while taking no focus and no clicks. */}
              <div className={styles.main}>
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={styles.tabPanel}
                    hidden={tab.id !== activeId}
                    inert={tab.id !== activeId}
                  >
                    {renderTab(tab)}
                  </div>
                ))}
              </div>

              {isLibrary && (
                <aside className={styles.panel} aria-label="Reading overview">
                  <ReadingProgress />
                  <WeeklyStats />
                </aside>
              )}
            </div>
          </div>
          )}

          <OpenModeDialog fileName={openPrompt} onChoose={chooseOpenMode} />
          {coverJob && <PdfCoverCapture job={coverJob} onDone={clearCoverJob} />}
          <ThemeColorResetGuard />
        </UpdaterProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}