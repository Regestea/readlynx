import { TrendingUp } from "lucide-react";
import type { WeekStat } from "../../shared/types";
import { formatMinutes } from "../../shared/utils";
import styles from "./StatisticsCard.module.css";

interface StatisticsCardProps {
  stats: WeekStat[];
}

export function StatisticsCard({ stats }: StatisticsCardProps) {
  const maxMinutes = Math.max(...stats.map((day) => day.minutes), 1);
  const totalMinutes = stats.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <div className={styles.stats}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Weekly Reading</h2>
          <p className={styles.period}>Last 7 days</p>
        </div>
      </div>

      <div className={styles.chart} role="img" aria-label="Minutes read per day this week">
        {stats.map((day) => (
          <div key={day.day} className={styles.barWrap}>
            <span
              className={`${styles.bar} ${day.isToday ? styles.barToday : ""}`}
              style={{ height: `${Math.max((day.minutes / maxMinutes) * 100, 8)}%` }}
              title={`${day.label}: ${formatMinutes(day.minutes)}`}
            />
            <span className={styles.dayLabel}>{day.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <p className={styles.total}>
          <strong>{formatMinutes(totalMinutes)}</strong> this week
        </p>
        <span className={styles.delta}>
          <TrendingUp size={13} strokeWidth={2} aria-hidden="true" />
          12% more
        </span>
      </div>
    </div>
  );
}
