import type { ReaderViewer } from "../infrastructure/db/entities/ReaderSettings.ts";

/**
 * Reader colors are picked against one theme: a light background with dark
 * text becomes unreadable the moment the app switches to the other theme (and
 * vice versa), which reads like a broken app rather than a personal choice.
 * So a user-initiated theme switch puts the *global* reader colors back to
 * "follow the theme" (Settings → reader defaults), and the caller explains
 * that with a dialog.
 *
 * Per-book overrides are deliberately left alone: they are explicit, made for
 * one specific book, and their own color picker can put them back.
 */

/** Reader color columns of `ReaderDefaults` — everything else (zoom, font,
 *  code syntax theme, hard text override) survives a theme switch. */
const COLOR_COLUMNS = [
  "customBg",
  "customText",
  "pdfBackground",
  "codeBackground",
  "diagramBackground",
] as const;

type Listener = (viewers: ReaderViewer[]) => void;

const listeners = new Set<Listener>();

/** Lets every mounted `useReaderDefaults` instance drop its stale local copy
 *  after {@link resetReaderColorsToTheme} rewrote the rows behind its back. */
export function subscribeReaderColorsReset(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announces which viewer rows had their colors cleared. */
export function notifyReaderColorsReset(viewers: ReaderViewer[]): void {
  for (const listener of [...listeners]) {
    try {
      listener(viewers);
    } catch {
      // A broken subscriber must not stop the others from updating.
    }
  }
}

/** Clears the global reader colors of every viewer that has one set and
 *  returns the viewers that were touched (empty when everything already
 *  followed the theme, so no dialog is needed).
 *
 *  Each row is written back in full: `updateReaderDefaults` clears every color
 *  column it is not given, so a partial patch would wipe the code/diagram
 *  syntax themes as well. */
export async function resetReaderColorsToTheme(): Promise<ReaderViewer[]> {
  const db = window.readlynx?.db;
  if (!db) return [];
  const rows = await db.listReaderDefaults();
  const changed: ReaderViewer[] = [];
  for (const row of rows) {
    if (!COLOR_COLUMNS.some((column) => row[column])) continue;
    await db.updateReaderDefaults(row.viewer, {
      zoomPct: row.zoomPct,
      fontFamily: row.fontFamily,
      textHardOverride: row.textHardOverride,
      softBookColors: row.softBookColors,
      codeTheme: row.codeTheme,
      diagramTheme: row.diagramTheme,
      customBg: null,
      customText: null,
      pdfBackground: null,
      codeBackground: null,
      diagramBackground: null,
    });
    changed.push(row.viewer);
  }
  return changed;
}

/** Human-readable names of the affected viewers, for the warning dialog. */
const VIEWER_LABELS: Record<ReaderViewer, string> = {
  epub: "EPUB",
  markdown: "translations",
  pdf: "PDF",
  image: "image",
};

/** "EPUB and translations" / "PDF" — used in the dialog body. */
export function describeViewers(viewers: ReaderViewer[]): string {
  const names = viewers.map((viewer) => VIEWER_LABELS[viewer]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
