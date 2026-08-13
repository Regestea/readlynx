import { useEffect, useState } from "react";
import { StatisticsCard } from "../StatisticsCard/StatisticsCard";
import { Card } from "../../../../components/ui/Card/Card";
import type { WeekStat } from "../../../../shared/types";
import styles from "./WeeklyStats.module.css";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export function WeeklyStats() {
  const [stats, setStats] = useState<WeekStat[] | null>(null);

  useEffect(() => {
    const db = window.readlynx?.db;
    if (!db) return;
    let cancelled = false;
    void db.getWeekReadingSessions().then(({ days }) => {
      if (cancelled) return;
      setStats(
        days.map((bucket, index) => {
          const date = new Date(`${bucket.day}T00:00:00`);
          return {
            day: bucket.day,
            label: DAY_LETTERS[date.getDay()] ?? "?",
            minutes: Math.round(bucket.seconds / 60),
            isToday: index === days.length - 1,
          };
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (stats === null) return null;

  return (
    <Card variant="glass" className={`animate-fade-up ${styles.widget}`}>
      <StatisticsCard stats={stats} />
    </Card>
  );
}