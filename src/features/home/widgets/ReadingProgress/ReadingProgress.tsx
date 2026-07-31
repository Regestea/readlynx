import { BookOpen } from "lucide-react";
import { Progress } from "../../../../components/ui/Progress/Progress";
import { Card } from "../../../../components/ui/Card/Card";
import { overallPages, overallProgress, weeklyProgressBooks } from "../../data/mockData";
import styles from "./ReadingProgress.module.css";

export function ReadingProgress() {
  return (
    <Card variant="glass" className={`animate-fade-up ${styles.widget}`}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Reading Progress</h2>
          <p className={styles.subtitle}>This week&apos;s journey</p>
        </div>
        <span className={styles.headIcon} aria-hidden="true">
          <BookOpen size={18} strokeWidth={1.8} />
        </span>
      </div>

      <div className={styles.ring}>
        <Progress variant="circular" value={overallProgress} size={140} strokeWidth={11} />
        <div className={styles.ringLabel}>
          <strong className={styles.ringPercent}>{Math.round(overallProgress * 100)}%</strong>
          <span className={styles.ringMeta}>of {overallPages} pages</span>
        </div>
      </div>

      <ul className={styles.list}>
        {weeklyProgressBooks.map((book) => (
          <li key={book.id} className={styles.row}>
            <span className={styles.thumb} aria-hidden="true">
              {book.title.charAt(0)}
            </span>
            <div className={styles.rowInfo}>
              <div className={styles.rowTop}>
                <span className={styles.rowTitle}>{book.title}</span>
                <span className={styles.rowPercent}>
                  {typeof book.progress === "number" ? Math.round(book.progress * 100) : 0}%
                </span>
              </div>
              <Progress
                value={book.progress ?? 0}
                thickness={6}
                className={styles.rowProgress}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
