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
 *  color and never touches the PDF file.
 *
 *  Fallback order for a book that was never customized: per-book row first,
 *  then the global `ReaderDefaults` row for "pdf" edited in Settings, then
 *  the hardcoded default. Merely opening a book never creates a per-book
 *  row, so new books keep following the global default. */
export function PdfThemeProvider({ children, bookId }: PdfThemeProviderProps) {
  const [state, setState] = useState<PdfThemeState>(() => ({
    background: PDF_THEME_DEFAULT_BACKGROUND,
  }));
  const loadedRef = useRef(!bookId);
  const snapshotRef = useRef<string>(PDF_THEME_DEFAULT_BACKGROUND);

  /** Loads the saved background for the book. Until it resolves the default
   *  is shown and nothing is persisted, so a default value is never written
   *  over the saved one. */
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    loadedRef.current = false;
    const load = async () => {
      try {
        const [row, defaults] = await Promise.all([
          window.readlynx?.db.getReaderSettings(bookId, "pdf"),
          window.readlynx?.db.getReaderDefaults("pdf").catch(() => null),
        ]);
        if (cancelled) return;
        const background =
          (row?.pdfBackground && isValidHexColor(row.pdfBackground)
            ? row.pdfBackground
            : null) ??
          (defaults?.pdfBackground && isValidHexColor(defaults.pdfBackground)
            ? defaults.pdfBackground
            : null);
        if (background) {
          snapshotRef.current = background;
          setState({ background });
        } else {
          snapshotRef.current = PDF_THEME_DEFAULT_BACKGROUND;
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
    if (state.background === snapshotRef.current) return;
    snapshotRef.current = state.background;
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