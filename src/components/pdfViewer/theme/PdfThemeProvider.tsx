import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PdfThemeState } from "./PdfThemeManager";
import {
  isValidHexColor,
  PDF_THEME_DEFAULT_BACKGROUND,
  savePdfTheme,
} from "./PdfThemeManager";
import { PdfThemeContext } from "./PdfThemeContext";

interface PdfThemeProviderProps {
  children: ReactNode;
  /** Book the theme belongs to. When given, the background is persisted in
   *  the book's `ReaderSettings` row (`viewer = "pdf"`); without it (plain
   *  previews) the old localStorage fallback is used. */
  bookId?: string;
}

/** Owns the PDF reader background theme and persists the user preference to
 *  the book's `ReaderSettings` row (replacing the old localStorage storage).
 *  Rendering stays in pdfjs-dist — this provider only stores the background
 *  color and never touches the PDF file. */
export function PdfThemeProvider({ children, bookId }: PdfThemeProviderProps) {
  const [state, setState] = useState<PdfThemeState>(() => ({
    background: PDF_THEME_DEFAULT_BACKGROUND,
  }));
  const loadedRef = useRef(!bookId);

  /** Loads the saved background for the book. Until it resolves the default
   *  is shown and nothing is persisted, so a default value is never written
   *  over the saved one. */
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    loadedRef.current = false;
    const load = async () => {
      try {
        const row = await window.readlynx?.db.getReaderSettings(bookId, "pdf");
        if (cancelled) return;
        if (row?.pdfBackground && isValidHexColor(row.pdfBackground)) {
          setState({ background: row.pdfBackground });
        }
      } catch {
        // keep the default
      } finally {
        if (!cancelled) loadedRef.current = true;
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (bookId) {
      void window.readlynx?.db.updateReaderSettings(bookId, "pdf", {
        pdfBackground: state.background,
      });
    } else {
      savePdfTheme(state);
    }
  }, [state, bookId]);

  const setBackground = useCallback((background: string) => {
    setState({ background });
  }, []);

  const reset = useCallback(() => {
    setState({ background: PDF_THEME_DEFAULT_BACKGROUND });
  }, []);

  const value = useMemo(() => ({ state, setBackground, reset }), [state, setBackground, reset]);

  return <PdfThemeContext.Provider value={value}>{children}</PdfThemeContext.Provider>;
}