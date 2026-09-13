import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MarkdownBlockTheme,
  ReaderViewer,
} from "../infrastructure/db/entities/ReaderSettings.ts";
import { normalizeBlockTheme } from "../infrastructure/db/entities/ReaderSettings.ts";

/** Global fallback for one viewer, edited in Settings. Books without a
 *  per-book `ReaderSettings` row start from these values. */
export interface ReaderDefaults {
  zoomPct: number;
  fontFamily: string;
  customBg: string | null;
  customText: string | null;
  hardOverrideText: boolean;
  pdfBackground: string | null;
  codeTheme: MarkdownBlockTheme | null;
  diagramTheme: MarkdownBlockTheme | null;
  codeBackground: string | null;
  diagramBackground: string | null;
}

const DEFAULTS: ReaderDefaults = {
  zoomPct: 100,
  fontFamily: "",
  customBg: null,
  customText: null,
  hardOverrideText: false,
  pdfBackground: null,
  codeTheme: null,
  diagramTheme: null,
  codeBackground: null,
  diagramBackground: null,
};

function same(a: ReaderDefaults, b: ReaderDefaults): boolean {
  return (
    a.zoomPct === b.zoomPct &&
    a.fontFamily === b.fontFamily &&
    a.customBg === b.customBg &&
    a.customText === b.customText &&
    a.hardOverrideText === b.hardOverrideText &&
    a.pdfBackground === b.pdfBackground &&
    a.codeTheme === b.codeTheme &&
    a.diagramTheme === b.diagramTheme &&
    a.codeBackground === b.codeBackground &&
    a.diagramBackground === b.diagramBackground
  );
}

/** Global reader defaults for one viewer, persisted in the `ReaderDefaults`
 *  table. Used by the Settings page; readers fall back to these values for
 *  books that were never customized per book. */
export function useReaderDefaults(viewer: ReaderViewer) {
  const [loaded, setLoaded] = useState(false);
  const [values, setValues] = useState<ReaderDefaults>(DEFAULTS);
  const snapshotRef = useRef<ReaderDefaults>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const row = await window.readlynx?.db.getReaderDefaults(viewer);
        if (cancelled) return;
        if (row) {
          const next: ReaderDefaults = {
            zoomPct:
              typeof row.zoomPct === "number" && Number.isFinite(row.zoomPct)
                ? row.zoomPct
                : DEFAULTS.zoomPct,
            fontFamily: typeof row.fontFamily === "string" ? row.fontFamily : "",
            customBg: row.customBg ?? null,
            customText: row.customText ?? null,
            hardOverrideText: Number(row.textHardOverride ?? 0) === 1,
            pdfBackground: row.pdfBackground ?? null,
            codeTheme: normalizeBlockTheme(row.codeTheme),
            diagramTheme: normalizeBlockTheme(row.diagramTheme),
            codeBackground: row.codeBackground ?? null,
            diagramBackground: row.diagramBackground ?? null,
          };
          snapshotRef.current = next;
          setValues(next);
        } else {
          snapshotRef.current = DEFAULTS;
          setValues(DEFAULTS);
        }
      } catch {
        // keep hardcoded defaults
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [viewer]);

  /** Persists only real user edits: the initial load (global defaults applied
   *  as the starting state) never creates a row by itself. */
  useEffect(() => {
    if (!loaded) return;
    if (same(values, snapshotRef.current)) return;
    snapshotRef.current = values;
    void window.readlynx?.db
      .updateReaderDefaults(viewer, {
        zoomPct: values.zoomPct,
        fontFamily: values.fontFamily,
        customBg: values.customBg,
        customText: values.customText,
        textHardOverride: values.hardOverrideText ? 1 : 0,
        pdfBackground: values.pdfBackground,
        codeTheme: values.codeTheme,
        diagramTheme: values.diagramTheme,
        codeBackground: values.codeBackground,
        diagramBackground: values.diagramBackground,
      })
      .catch(() => undefined);
  }, [loaded, values, viewer]);

  const patch = useCallback((next: Partial<ReaderDefaults>) => {
    setValues((current) => ({ ...current, ...next }));
  }, []);

  const reset = useCallback(() => {
    setValues(DEFAULTS);
  }, []);

  return useMemo(
    () => ({ ...values, loaded, setValues: patch, reset }),
    [values, loaded, patch, reset],
  );
}
