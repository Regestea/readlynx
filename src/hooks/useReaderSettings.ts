import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MarkdownBlockTheme,
  ReaderViewer,
} from "../infrastructure/db/entities/ReaderSettings.ts";
import { normalizeBlockTheme } from "../infrastructure/db/entities/ReaderSettings.ts";

export type { MarkdownBlockTheme };

export interface ReaderSettings {
  zoomPct: number;
  fontFamily: string;
  customBg: string | null;
  customText: string | null;
  /** EPUB-only hard text-color override (true = force the text color onto
   *  every element with `!important`). */
  hardOverrideText: boolean;
  /** EPUB-only soft colors (true = replace author colors that are louder than
   *  the app's reading inks with those inks). On by default, app-wide. */
  softBookColors: boolean;
  /** Markdown-only code-block syntax theme (null = follow the app theme). */
  codeTheme: MarkdownBlockTheme | null;
  /** Markdown-only Mermaid diagram theme (null = follow the app theme). */
  diagramTheme: MarkdownBlockTheme | null;
  /** Code-block background for both viewers (null = follow the theme: the
   *  Markdown viewer's code card, the EPUB reader's tinted page background). */
  codeBackground: string | null;
  /** Markdown-only diagram background (null = follow the theme card). */
  diagramBackground: string | null;
}

/** Defaults used when the book has no saved row yet. */
const DEFAULT_SETTINGS: ReaderSettings = {
  zoomPct: 100,
  fontFamily: "",
  customBg: null,
  customText: null,
  hardOverrideText: false,
  softBookColors: true,
  codeTheme: null,
  diagramTheme: null,
  codeBackground: null,
  diagramBackground: null,
};

/** Per-book, per-viewer reader settings persisted in the `ReaderSettings`
 *  table (replacing the old localStorage storage). Pass the book id and the
 *  viewer — e.g. `useReaderSettings(bookId, "epub")` for the EPUB viewer and
 *  `useReaderSettings(bookId, "markdown")` for the translation Markdown view —
 *  so zoom, font family and text/background colors are stored separately for
 *  each viewer of each book and survive reloads. Without a book id the hook
 *  stays in-memory (used by previews with no backing book).
 *
 *  Fallback order for a book that was never customized: per-book row first,
 *  then the global `ReaderDefaults` row edited in Settings, then the
 *  hardcoded defaults. A per-book row is only created once the user actually
 *  changes a value, so newly added books keep following the global defaults
 *  until then. */
export function useReaderSettings(bookId: string | undefined, viewer: ReaderViewer) {
  const [loaded, setLoaded] = useState(false);
  const [zoomPct, setZoomPct] = useState<number>(DEFAULT_SETTINGS.zoomPct);
  const [fontFamily, setFontFamily] = useState(DEFAULT_SETTINGS.fontFamily);
  const [customBg, setCustomBg] = useState<string | null>(DEFAULT_SETTINGS.customBg);
  const [customText, setCustomText] = useState<string | null>(DEFAULT_SETTINGS.customText);
  const [hardOverrideText, setHardOverrideText] = useState<boolean>(
    DEFAULT_SETTINGS.hardOverrideText,
  );
  const [softBookColors, setSoftBookColors] = useState<boolean>(DEFAULT_SETTINGS.softBookColors);
  const [codeTheme, setCodeTheme] = useState<MarkdownBlockTheme | null>(null);
  const [diagramTheme, setDiagramTheme] = useState<MarkdownBlockTheme | null>(null);
  const [codeBackground, setCodeBackground] = useState<string | null>(null);
  const [diagramBackground, setDiagramBackground] = useState<string | null>(null);
  const snapshotRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);

  /** Loads the saved settings once per (book, viewer) pair. */
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [row, defaults] = await Promise.all([
          window.readlynx?.db.getReaderSettings(bookId, viewer),
          window.readlynx?.db.getReaderDefaults(viewer).catch(() => null),
        ]);
        if (cancelled) return;
        const source = row ?? defaults;
        if (!source) return;
        const next: ReaderSettings = {
          zoomPct:
            typeof source.zoomPct === "number" && Number.isFinite(source.zoomPct)
              ? source.zoomPct
              : DEFAULT_SETTINGS.zoomPct,
          fontFamily: typeof source.fontFamily === "string" ? source.fontFamily : "",
          customBg: source.customBg ?? null,
          customText: source.customText ?? null,
          hardOverrideText: Number(source.textHardOverride ?? 0) === 1,
          softBookColors: Number(source.softBookColors ?? 1) === 1,
          codeTheme: normalizeBlockTheme(source.codeTheme),
          diagramTheme: normalizeBlockTheme(source.diagramTheme),
          codeBackground: source.codeBackground ?? null,
          diagramBackground: source.diagramBackground ?? null,
        };
        snapshotRef.current = next;
        setZoomPct(next.zoomPct);
        setFontFamily(next.fontFamily);
        setCustomBg(next.customBg);
        setCustomText(next.customText);
        setHardOverrideText(next.hardOverrideText);
        setSoftBookColors(next.softBookColors);
        setCodeTheme(next.codeTheme);
        setDiagramTheme(next.diagramTheme);
        setCodeBackground(next.codeBackground);
        setDiagramBackground(next.diagramBackground);
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId, viewer]);

  /** Persists changes back into the book's `ReaderSettings` row. The save
   *  waits for the initial load so a default value is never written over the
   *  saved one before it is read, and it skips when the current values still
   *  equal the loaded snapshot — so merely opening a book never creates a
   *  per-book row and the book keeps following the global defaults. */
  useEffect(() => {
    if (!bookId || !loaded) return;
    const snapshot = snapshotRef.current;
    if (
      zoomPct === snapshot.zoomPct &&
      fontFamily === snapshot.fontFamily &&
      customBg === snapshot.customBg &&
      customText === snapshot.customText &&
      hardOverrideText === snapshot.hardOverrideText &&
      softBookColors === snapshot.softBookColors &&
      codeTheme === snapshot.codeTheme &&
      diagramTheme === snapshot.diagramTheme &&
      codeBackground === snapshot.codeBackground &&
      diagramBackground === snapshot.diagramBackground
    ) {
      return;
    }
    snapshotRef.current = {
      zoomPct,
      fontFamily,
      customBg,
      customText,
      hardOverrideText,
      softBookColors,
      codeTheme,
      diagramTheme,
      codeBackground,
      diagramBackground,
    };
    void window.readlynx?.db.updateReaderSettings(bookId, viewer, {
      zoomPct,
      fontFamily,
      customBg,
      customText,
      textHardOverride: hardOverrideText ? 1 : 0,
      softBookColors: softBookColors ? 1 : 0,
      codeTheme,
      diagramTheme,
      codeBackground,
      diagramBackground,
    });
  }, [
    bookId,
    viewer,
    loaded,
    zoomPct,
    fontFamily,
    customBg,
    customText,
    hardOverrideText,
    softBookColors,
    codeTheme,
    diagramTheme,
    codeBackground,
    diagramBackground,
  ]);

  return useMemo(
    () => ({
      zoomPct,
      setZoomPct,
      fontFamily,
      setFontFamily,
      customBg,
      setCustomBg,
      customText,
      setCustomText,
      hardOverrideText,
      setHardOverrideText,
      softBookColors,
      setSoftBookColors,
      codeTheme,
      setCodeTheme,
      diagramTheme,
      setDiagramTheme,
      codeBackground,
      setCodeBackground,
      diagramBackground,
      setDiagramBackground,
    }),
    [
      zoomPct,
      fontFamily,
      customBg,
      customText,
      hardOverrideText,
      softBookColors,
      codeTheme,
      diagramTheme,
      codeBackground,
      diagramBackground,
    ],
  );
}





