import { useEffect, useRef } from "react";

/** Re-runs the callback a moment after every local midnight — so daily
 *  widgets (reading time, weekly stats) roll over at 00:00 for the user even
 *  when the app stays open across the boundary. */
export function useDailyRefresh(onRefresh: () => void): void {
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0,
        500,
      ).getTime();
      timer = window.setTimeout(() => {
        refreshRef.current();
        schedule();
      }, Math.max(1000, nextMidnight - Date.now()));
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
}