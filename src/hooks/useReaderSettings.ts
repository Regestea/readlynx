import { useEffect, useMemo, useState } from "react";
import type { ReaderViewer } from "../infrastructure/db/entities/ReaderSettings.ts";

export interface ReaderSettings {
  zoomPct: number;
  fontFamily: string;
  customBg: string | null;
  customText: string | null;
  /** EPUB-only hard text-color override (true = force the text color onto
   *  every element with `!important`). */
  hardOverrideText: boolean;
}

/** Defaults used when the book has no saved row yet. */
const DEFAULT_SETTINGS: ReaderSettings = {
  zoomPct: 100,
  fontFamily: "",
  customBg: null,
  customText: null,
  hardOverrideText: false,
};

/** Per-book, per-viewer reader settings persisted in the `ReaderSettings`
 *  table (replacing the old localStorage storage). Pass the book id and the
 *  viewer — e.g. `useReaderSettings(bookId, "epub")` for the EPUB viewer and
 *  `useReaderSettings(bookId, "markdown")` for the translation Markdown view —
 *  so zoom, font family and text/background colors are stored separately for
 *  each viewer of each book and survive reloads. Without a book id the hook
 *  stays in-memory (used by previews with no backing book). */
export function useReaderSettings(bookId: string | undefined, viewer: ReaderViewer) {
  const [loaded, setLoaded] = useState(false);
  const [zoomPct, setZoomPct] = useState<number>(DEFAULT_SETTINGS.zoomPct);
  const [fontFamily, setFontFamily] = useState(DEFAULT_SETTINGS.fontFamily);
  const [customBg, setCustomBg] = useState<string | null>(DEFAULT_SETTINGS.customBg);
  const [customText, setCustomText] = useState<string | null>(DEFAULT_SETTINGS.customText);
  const [hardOverrideText, setHardOverrideText] = useState<boolean>(
    DEFAULT_SETTINGS.hardOverrideText,
  );

  /** Loads the saved settings once per (book, viewer) pair. */
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const row = await window.readlynx?.db.getReaderSettings(bookId, viewer);
        if (cancelled || !row) return;
        if (typeof row.zoomPct === "number" && Number.isFinite(row.zoomPct)) {
          setZoomPct(row.zoomPct);
        }
        if (typeof row.fontFamily === "string") setFontFamily(row.fontFamily);
        setCustomBg(row.customBg ?? null);
        setCustomText(row.customText ?? null);
        setHardOverrideText(Number(row.textHardOverride ?? 0) === 1);
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
   *  saved one before it is read. */
  useEffect(() => {
    if (!bookId || !loaded) return;
    void window.readlynx?.db.updateReaderSettings(bookId, viewer, {
      zoomPct,
      fontFamily,
      customBg,
      customText,
      textHardOverride: hardOverrideText ? 1 : 0,
    });
  }, [bookId, viewer, loaded, zoomPct, fontFamily, customBg, customText, hardOverrideText]);

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
    }),
    [zoomPct, fontFamily, customBg, customText, hardOverrideText],
  );
}
