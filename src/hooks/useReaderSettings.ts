import { useEffect, useMemo, useState } from "react";

export interface ReaderSettings {
  zoomPct: number;
  fontFamily: string;
  customBg: string | null;
  customText: string | null;
}

const STORAGE_PREFIX = "readlynx:reader:";

/** Reads the stored settings for a key; tolerant of missing/corrupt data. */
function readStored(settingsKey: string | undefined): Partial<ReaderSettings> {
  if (!settingsKey) return {};
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + settingsKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    const out: Partial<ReaderSettings> = {};
    if (typeof parsed.zoomPct === "number" && Number.isFinite(parsed.zoomPct)) {
      out.zoomPct = parsed.zoomPct;
    }
    if (typeof parsed.fontFamily === "string") {
      out.fontFamily = parsed.fontFamily;
    }
    if (typeof parsed.customBg === "string" || parsed.customBg === null) {
      out.customBg = parsed.customBg ?? null;
    }
    if (typeof parsed.customText === "string" || parsed.customText === null) {
      out.customText = parsed.customText ?? null;
    }
    return out;
  } catch {
    return {};
  }
}

/** Per-file, per-viewer reader settings persisted in localStorage. Callers
 *  pass a distinct key per (file, viewer) pair — e.g. `<bookId>:epub` and
 *  `<bookId>:markdown` — so zoom, font family and text/background colors are
 *  stored separately for the EPUB viewer and the Markdown viewer of each
 *  file, and survive reloads. */
export function useReaderSettings(settingsKey?: string) {
  const stored = useMemo(() => readStored(settingsKey), [settingsKey]);
  const [zoomPct, setZoomPct] = useState<number>(stored.zoomPct ?? 100);
  const [fontFamily, setFontFamily] = useState(stored.fontFamily ?? "");
  const [customBg, setCustomBg] = useState<string | null>(stored.customBg ?? null);
  const [customText, setCustomText] = useState<string | null>(stored.customText ?? null);

  useEffect(() => {
    if (!settingsKey) return;
    try {
      localStorage.setItem(
        STORAGE_PREFIX + settingsKey,
        JSON.stringify({ zoomPct, fontFamily, customBg, customText } satisfies ReaderSettings),
      );
    } catch {
      // Storage unavailable or full — persist nothing, keep working.
    }
  }, [zoomPct, fontFamily, customBg, customText, settingsKey]);

  return {
    zoomPct,
    setZoomPct,
    fontFamily,
    setFontFamily,
    customBg,
    setCustomBg,
    customText,
    setCustomText,
  };
}