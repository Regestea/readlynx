import { useState } from "react";
import { ThemeProvider } from "./providers/theme/ThemeProvider";
import { Header } from "../components/Header/Header";
import { Sidebar } from "../components/Sidebar/Sidebar";
import { HomePage } from "../features/home/components/HomePage";
import { ShowcasePage } from "../features/showcase/components/ShowcasePage";
import { Quote } from "../features/home/widgets/Quote/Quote";
import { ReadingProgress } from "../features/home/widgets/ReadingProgress/ReadingProgress";
import { WeeklyStats } from "../features/home/widgets/WeeklyStats/WeeklyStats";
import styles from "./App.module.css";

export default function App() {
  const [activeId, setActiveId] = useState("home");
  const isHome = activeId === "home";

  return (
    <ThemeProvider>
      <div className="app-background" aria-hidden="true">
        <div className="app-background-layer app-background-layer--day" />
        <div className="app-background-layer app-background-layer--night" />
        <div className="app-background-overlay" />
      </div>

      <div className={styles.shell}>
        <Sidebar activeId={activeId} onNavigate={setActiveId} />

        <div className={styles.main}>
          <Header />
          {isHome ? <HomePage /> : <ShowcasePage />}
        </div>

        <aside className={styles.panel} aria-label="Reading overview">
          <ReadingProgress />
          <Quote />
          <WeeklyStats />
        </aside>
      </div>
    </ThemeProvider>
  );
}
