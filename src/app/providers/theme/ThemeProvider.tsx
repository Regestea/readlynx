import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Theme } from "../../../shared/types";
import { getSystemTheme, ThemeContext } from "./ThemeContext";

/** Theme persistence lives in the `AppSettings` DB table (via the worker),
 *  not localStorage. We start from the system preference to avoid a flash,
 *  then adopt the saved value once it loads — without persisting the initial
 *  system value over the user's choice before that happens. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeValue] = useState<Theme>(() => getSystemTheme());
  /** Bumped only by the user-facing actions below, never by the startup
   *  hydration — app-level listeners reset theme-dependent settings on it. */
  const [themeChangeCount, setThemeChangeCount] = useState(0);
  const initialTheme = useRef(theme);
  const loaded = useRef(false);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!loaded.current) return;
    void window.readlynx?.db.updateAppSettings({ theme }).catch(() => {});
  }, [theme]);

  useEffect(() => {
    const db = window.readlynx?.db;
    if (!db) return;
    let cancelled = false;
    void db.getAppSettings().then((settings) => {
      if (cancelled) return;
      loaded.current = true;
      const savedTheme = settings?.theme;
      if (savedTheme === "light" || savedTheme === "dark") {
        setThemeValue((current) =>
          current === initialTheme.current ? savedTheme : current,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeValue(next);
    setThemeChangeCount((count) => count + 1);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeValue((current) => (current === "light" ? "dark" : "light"));
    setThemeChangeCount((count) => count + 1);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, themeChangeCount }),
    [theme, setTheme, toggleTheme, themeChangeCount],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
