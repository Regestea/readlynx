import { createContext, useContext } from "react";
import type { PdfThemeState } from "./PdfThemeManager";

export interface PdfThemeContextValue {
  /** Current reader background color. */
  state: PdfThemeState;
  /** Sets the reader background color. */
  setBackground: (color: string) => void;
  /** Restores the default eye-friendly background. */
  reset: () => void;
}

export const PdfThemeContext = createContext<PdfThemeContextValue | null>(null);

export function usePdfTheme(): PdfThemeContextValue {
  const context = useContext(PdfThemeContext);
  if (!context) {
    throw new Error("usePdfTheme must be used within a PdfThemeProvider");
  }
  return context;
}