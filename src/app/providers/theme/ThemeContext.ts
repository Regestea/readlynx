import { createContext, useContext } from "react";
import type { Theme } from "../../../shared/types";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** Counts user-initiated theme switches. The theme value also changes once
   *  at startup when the saved theme is hydrated from the DB — that never
   *  counts, so listeners can tell a real switch from the initial load. */
  themeChangeCount: number;
}

export function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
