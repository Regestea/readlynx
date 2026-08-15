import { useCallback, useEffect, useRef, useState } from "react";
import { StatisticsCard } from "../StatisticsCard/StatisticsCard";
import { Card } from "../../../../components/ui/Card/Card";
import { useDailyRefresh } from "../../../../shared/useDailyRefresh";
import type { WeekStat } from "../../../../shared/types";
import styles from "./WeeklyStats.module.css";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export function WeeklyStats() {
  const [stats, setStats] = useState<WeekStat[] | null>(null);
  const mountedRef = useRef(false);

  const load = useCallback(async () => {
    const db = window.readlynx?.db;
    if (!db) return;
    const { days } = await db.getWeekReadingEvents();
    if (!mountedRef.current) return;
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
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  /** Shifts the "today" bar to the new day at local midnight, even while the
   *  app stays open. */
  useDailyRefresh(load);

  if (stats === null) return null;

  return (
    <Card variant="glass" className={`animate-fade-up ${styles.widget}`}>
      <StatisticsCard stats={stats} />
    </Card>
  );
}