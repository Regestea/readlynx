import { useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Theme } from "../../../shared/types";
import {
  getInitialTheme,
  STORAGE_KEY,
  ThemeContext,
} from "./ThemeContext";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  // useLayoutEffect so the data-theme attribute is applied before any
  // child effect (e.g. Mermaid reading theme tokens) runs.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage unavailable — theme still applies for this session
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "light" ? "dark" : "light")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
