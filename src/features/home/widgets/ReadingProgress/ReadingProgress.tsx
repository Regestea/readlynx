import { useEffect, useState } from "react";
import { BookOpen, Target } from "lucide-react";
import { Progress } from "../../../../components/ui/Progress/Progress";
import { Card } from "../../../../components/ui/Card/Card";
import { Button } from "../../../../components/ui/Button/Button";
import { formatMinutes } from "../../../../shared/utils";
import type { ReadingProgressRow } from "../../../../infrastructure/db/entities/types";
import { ReadingGoalModal } from "./ReadingGoalModal";
import styles from "./ReadingProgress.module.css";

const MAX_ROWS = 4;

interface ProgressEntry {
  id: string;
  title: string;
  /** 0..1 — pages read / total pages (PDF) or real position (EPUB, epubjs
   *  location percentage, proportional to content rather than chapter
   *  count, so covers/TOC/back-matter don't skew it). */
  progress: number;
  /** Units consumed (pages or chapters), for the overall ring. EPUB books
   *  derive it from the real position × total chapters. */
  read: number;
  total: number;
  unitLabel: "pages" | "chapters";
}

function toEntry(row: ReadingProgressRow): ProgressEntry | null {
  if (row.totalPages > 0) {
    const read = Math.min(Math.max(0, row.currentPage), row.totalPages);
    return {
      id: row.bookId,
      title: row.title,
      progress: read / row.totalPages,
      read,
      total: row.totalPages,
      unitLabel: "pages",
    };
  }
  if (row.totalChapters > 0) {
    const progress = Math.min(1, Math.max(0, row.progressPercent));
    return {
      id: row.bookId,
      title: row.title,
      progress,
      read: Math.round(progress * row.totalChapters),
      total: row.totalChapters,
      unitLabel: "chapters",
    };
  }
  return null;
}

export function ReadingProgress() {
  const [entries, setEntries] = useState<ProgressEntry[] | null>(null);
  const [goalMinutes, setGoalMinutes] = useState<number | null>(null);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [goalOpen, setGoalOpen] = useState(false);

  useEffect(() => {
    const db = window.readlynx?.db;
    if (!db) return;
    let cancelled = false;
    void Promise.all([
      db.listReadingProgress(),
      db.getDailyGoal(),
      db.getWeekReadingSessions(),
    ]).then(([rows, goal, week]) => {
      if (cancelled) return;
      setEntries(rows.map(toEntry).filter((entry): entry is ProgressEntry => entry !== null));
      setGoalMinutes(goal.goalMinutes);
      setTodaySeconds(week.todaySeconds);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries === null || goalMinutes === null) return null;

  const todayMinutes = Math.round(todaySeconds / 60);
  const goalPct = goalMinutes > 0 ? todaySeconds / (goalMinutes * 60) : 0;
  const goalReached = goalPct >= 1;

  return (
    <Card variant="glass" className={`animate-fade-up ${styles.widget}`}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Reading Progress</h2>
          <p className={styles.subtitle}>This week&apos;s journey</p>
        </div>
        <div className={styles.headActions}>
          <Button
            variant="icon"
            className={styles.headIconButton}
            onClick={() => setGoalOpen(true)}
            aria-label="Set daily reading goal"
            title="Set daily goal"
          >
            <Target size={18} strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <span className={styles.headIcon} aria-hidden="true">
            <BookOpen size={18} strokeWidth={1.8} />
          </span>
        </div>
      </div>

      <div className={styles.ring}>
        <Progress variant="circular" value={goalPct} size={140} strokeWidth={11} />
        <div className={styles.ringLabel}>
          <strong className={styles.ringPercent}>{formatMinutes(todayMinutes)}</strong>
          <span className={styles.ringMeta}>of {formatMinutes(goalMinutes)}</span>
        </div>
      </div>
      <div className={`${styles.badge} ${goalReached ? styles.badgeDone : ""}`}>
        Today Goal
        {goalReached ? " · Done" : ""}
      </div>

      {entries.length === 0 ? (
        <p className={styles.empty}>Open a book to start tracking progress.</p>
      ) : (
        <ul className={styles.list}>
          {entries.slice(0, MAX_ROWS).map((book) => (
            <li key={book.id} className={styles.row}>
              <span className={styles.thumb} aria-hidden="true">
                {book.title.charAt(0)}
              </span>
              <div className={styles.rowInfo}>
                <div className={styles.rowTop}>
                  <span className={styles.rowTitle}>{book.title}</span>
                  <span className={styles.rowPercent}>
                    {Math.round(book.progress * 100)}%
                  </span>
                </div>
                <Progress value={book.progress} thickness={6} className={styles.rowProgress} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReadingGoalModal
        open={goalOpen}
        initialMinutes={goalMinutes}
        todayMinutes={todayMinutes}
        onClose={() => setGoalOpen(false)}
        onSaved={(minutes) => setGoalMinutes(minutes)}
      />
    </Card>
  );
}