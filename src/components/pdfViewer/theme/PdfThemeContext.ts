import { createContext, useContext } from "react";
import type { PdfThemeState } from "./PdfThemeManager";
import type { PdfDisplayMode } from "../pdfDisplayMode";

export interface PdfThemeContextValue {
  /** Current reader background color. */
  state: PdfThemeState;
  /** Sets the reader background color. */
  setBackground: (color: string) => void;
  /** Restores the default eye-friendly background. */
  reset: () => void;
  /** Page zoom as a percentage of the fitted page (100 = fills the reader). */
  zoomPct: number;
  /** Sets the page zoom; clamped to the range the viewer can render. */
  setZoomPct: (zoomPct: number) => void;
  /** False until the stored zoom has been read from the database. */
  zoomLoaded: boolean;
  /** How the pages are laid out: one continuous column or one page at a
   *  time. Persisted per book like the zoom. */
  displayMode: PdfDisplayMode;
  /** Switches the page layout; persisted per book. */
  setDisplayMode: (mode: PdfDisplayMode) => void;
  /** False until the stored display mode has been read — the viewer holds
   *  off mounting either layout until this is true, so a paged book never
   *  flickers through a scroll column (or the reverse). */
  displayModeLoaded: boolean;
}

export const PdfThemeContext = createContext<PdfThemeContextValue | null>(null);

export function usePdfTheme(): PdfThemeContextValue {
  const context = useContext(PdfThemeContext);
  if (!context) {
    throw new Error("usePdfTheme must be used within a PdfThemeProvider");
  }
  return context;
}