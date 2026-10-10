import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PdfThemeState } from "./PdfThemeManager";
import {
  isValidHexColor,
  PDF_THEME_DEFAULT_BACKGROUND,
  savePdfTheme,
} from "./PdfThemeManager";
import { clampPdfZoomPct, PDF_ZOOM_DEFAULT_PCT } from "../pdfZoom";
import { PdfThemeContext } from "./PdfThemeContext";

interface PdfThemeProviderProps {
  children: ReactNode;
  /** Book the settings belong to. When given, the background and the zoom
   *  are persisted in the book's `ReaderSettings` row (`viewer = "pdf"`);
   *  without it (plain previews) the old localStorage fallback is used for
   *  the background and the zoom stays in memory. */
  bookId?: string;
}

/** Owns the PDF reader settings that belong to a book — the reading
 *  background and the page zoom — and persists the user preference to the
 *  book's `ReaderSettings` row (replacing the old localStorage storage).
 *  Rendering stays in pdfjs-dist; this provider only stores preferences and
 *  never touches the PDF file.
 *
 *  Both live here because they share one row: `updateReaderSettings` writes
 *  every clearable column it is given, so a zoom-only save that left the
 *  color out would quietly reset the background to "follow the theme".
 *
 *  Fallback order for a book that was never customized: per-book row first,
 *  then the global `ReaderDefaults` row for "pdf" edited in Settings, then
 *  the hardcoded defaults. Merely opening a book never creates a per-book
 *  row, so new books keep following the global default. */
export function PdfThemeProvider({ children, bookId }: PdfThemeProviderProps) {
  const [state, setState] = useState<PdfThemeState>(() => ({
    background: PDF_THEME_DEFAULT_BACKGROUND,
  }));
  const [zoomPct, setZoomPctValue] = useState(PDF_ZOOM_DEFAULT_PCT);
  /** False until the stored zoom has been read, so the viewer can hold off
   *  its first fit instead of painting at 100% and then jumping. */
  const [zoomLoaded, setZoomLoaded] = useState(!bookId);
  const loadedRef = useRef(!bookId);
  const snapshotRef = useRef<string>(PDF_THEME_DEFAULT_BACKGROUND);
  const zoomSnapshotRef = useRef<number>(PDF_ZOOM_DEFAULT_PCT);
  /** What this book's own row holds for the background, which is not the same
   *  thing as the background on screen when it is inherited from the global
   *  default. Saving the effective value would freeze the default into the
   *  book and quietly detach it from later changes to that default. */
  const storedBackgroundRef = useRef<string | null>(null);

  /** Loads the saved background and zoom for the book. Until it resolves the
   *  defaults are shown and nothing is persisted, so a default value is never
   *  written over the saved one. */
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
        storedBackgroundRef.current =
          row?.pdfBackground && isValidHexColor(row.pdfBackground) ? row.pdfBackground : null;
        // 100% is the automatic fit, so a book still sitting on it counts as
        // "never zoomed" and follows the global default — otherwise every
        // book that merely picked a background would shadow that default
        // with a value the reader never chose.
        const rowZoom = row?.zoomPct;
        const zoom =
          typeof rowZoom === "number" &&
          Number.isFinite(rowZoom) &&
          rowZoom !== PDF_ZOOM_DEFAULT_PCT
            ? rowZoom
            : (defaults?.zoomPct ?? PDF_ZOOM_DEFAULT_PCT);
        zoomSnapshotRef.current = zoom;
        setZoomPctValue(clampPdfZoomPct(zoom));
      } catch {
        // keep the defaults
      } finally {
        if (!cancelled) {
          loadedRef.current = true;
          setZoomLoaded(true);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const backgroundChanged = state.background !== snapshotRef.current;
    const zoomChanged = zoomPct !== zoomSnapshotRef.current;
    if (!backgroundChanged && !zoomChanged) return;
    snapshotRef.current = state.background;
    zoomSnapshotRef.current = zoomPct;
    if (bookId) {
      if (backgroundChanged) storedBackgroundRef.current = state.background;
      // The background is always sent (a missing one would be stored as
      // "follow the theme"), but the zoom only when it actually moved:
      // `zoomPct` is the one column an omitted value leaves untouched, so
      // sending it unconditionally would pin the global default into every
      // book whose background is ever changed.
      void window.readlynx?.db.updateReaderSettings(bookId, "pdf", {
        pdfBackground: storedBackgroundRef.current,
        zoomPct: zoomChanged ? zoomPct : undefined,
      });
    } else if (backgroundChanged) {
      savePdfTheme(state);
    }
  }, [state, zoomPct, bookId]);

  const setBackground = useCallback((background: string) => {
    setState({ background });
  }, []);

  const reset = useCallback(() => {
    setState({ background: PDF_THEME_DEFAULT_BACKGROUND });
  }, []);

  const setZoomPct = useCallback((next: number) => {
    setZoomPctValue(clampPdfZoomPct(next));
  }, []);

  const value = useMemo(
    () => ({ state, setBackground, reset, zoomPct, setZoomPct, zoomLoaded }),
    [state, setBackground, reset, zoomPct, setZoomPct, zoomLoaded],
  );

  return <PdfThemeContext.Provider value={value}>{children}</PdfThemeContext.Provider>;
}