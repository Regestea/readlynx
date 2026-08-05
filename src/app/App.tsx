import { useState } from "react";
import { ThemeProvider } from "./providers/theme/ThemeProvider";
import { Header } from "../components/Header/Header";
import { Sidebar } from "../components/Sidebar/Sidebar";
import { HomePage } from "../features/home/components/HomePage";
import { ShowcasePage } from "../features/showcase/components/ShowcasePage";
import { CreateBookPage } from "../features/create/components/CreateBookPage";
import type { CreateBookDetails } from "../features/create/components/CreateBookDialog";
import { Quote } from "../features/home/widgets/Quote/Quote";
import { ReadingProgress } from "../features/home/widgets/ReadingProgress/ReadingProgress";
import { WeeklyStats } from "../features/home/widgets/WeeklyStats/WeeklyStats";
import styles from "./App.module.css";

export default function App() {
  const [activeId, setActiveId] = useState("home");
  const [createDetails, setCreateDetails] = useState<CreateBookDetails | null>(null);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isHome = activeId === "home";
  const isFullWidth = !isHome;

  const handleNavigate = (id: string) => {
    if (id !== "create-book") {
      setSidebarCollapsed(false);
    }
    setActiveId(id);
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
          {isHome && <Header />}
          {isHome && (
            <HomePage
              onCreateBook={(details) => {
                setCreateDetails(details);
                setOpenBookId(null);
                setActiveId("create-book");
              }}
              onOpenBook={(bookId) => {
                setCreateDetails(null);
                setOpenBookId(bookId);
                setActiveId("create-book");
              }}
            />
          )}
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
          {!isHome && activeId !== "create-book" && <ShowcasePage />}
        </div>

        {isHome && (
          <aside className={styles.panel} aria-label="Reading overview">
            <ReadingProgress />
            <Quote />
            <WeeklyStats />
          </aside>
        )}
      </div>
    </ThemeProvider>
  );
}
