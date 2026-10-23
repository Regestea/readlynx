/** Independent scroll memory for long documents (EPUB + Markdown, and PDF
 *  books read in the continuous-scroll layout).
 *
 *  Each view keeps its own position — switching between original and
 *  translation never transfers an offset to the other view (that pixel copy
 *  was the source of the visible "jump": the two documents have different
 *  heights, so the same pixel means a different paragraph).
 *
 *  Positions are stored as a 0..1 ratio (scrollTop / scrollable range) rather
 *  than pixels, so they stay valid across zoom / font / window-size changes.
 *  Persisted in localStorage per (book, view, unit) so they survive app
 *  restarts. Paged PDF books stay excluded (their position is the page number
 *  in the database); a PDF read as one continuous column saves its
 *  whole-document ratio under "pdf-scroll".
 */

export type ScrollViewKind = "epub-orig" | "md-orig" | "trans" | "pdf-scroll";

/** Namespace of every scroll key in localStorage. Also used by the startup
 *  sweep that drops entries whose book is gone. */
export const SCROLL_MEMORY_PREFIX = "readlynx:scroll:v1";

const PREFIX = SCROLL_MEMORY_PREFIX;

function keyFor(kind: ScrollViewKind, bookId: string, unit: string): string {
  return `${PREFIX}:${kind}:${bookId}:${unit}`;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Reads a saved 0..1 scroll ratio, or null when nothing was stored. */
export function loadScrollRatio(
  kind: ScrollViewKind,
  bookId: string,
  unit: string,
): number | null {
  try {
    const raw = localStorage.getItem(keyFor(kind, bookId, unit));
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return clampRatio(value);
  } catch {
    return null;
  }
}

/** Persists a 0..1 scroll ratio (no-op when storage is unavailable). */
export function saveScrollRatio(
  kind: ScrollViewKind,
  bookId: string,
  unit: string,
  ratio: number,
): void {
  try {
    localStorage.setItem(keyFor(kind, bookId, unit), String(clampRatio(ratio)));
  } catch {
    // private mode / quota — scroll memory is best-effort only.
  }
}

/** Drops every stored ratio of one book: the cleanup journal handed its id
 *  over after the book row was deleted, desktop-wide. */
export function forgetBookScrollMemory(bookId: string): void {
  try {
    const marker = `:${bookId}:`;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(`${PREFIX}:`) || !key.includes(marker)) continue;
      localStorage.removeItem(key);
    }
  } catch {
    // storage unavailable — nothing to forget.
  }
}

/** Ratio from a scrollable element's current offset (null when not scrollable). */
export function markdownRatio(element: HTMLElement | null): number | null {
  if (!element) return null;
  const max = element.scrollHeight - element.clientHeight;
  if (max <= 0) return null;
  return clampRatio(element.scrollTop / max);
}

/** Applies a saved ratio to a Markdown scroll host with retries: content
 *  height settles late (zoom, images, KaTeX), so a single immediate write
 *  often lands on max=0 or a stale height. Retried via rAF + timeouts. */
export function restoreMarkdownRatio(
  element: HTMLElement | null,
  ratio: number,
  attempts = 6,
): void {
  if (!element) return;
  const target = clampRatio(ratio);
  if (target <= 0) return;
  let left = attempts;
  const tick = () => {
    const max = element.scrollHeight - element.clientHeight;
    if (max > 0) {
      element.scrollTop = Math.min(max, Math.max(0, target * max));
      // Height can still grow (images); keep nudging until stable.
      left -= 1;
      if (left > 0) window.setTimeout(() => requestAnimationFrame(tick), 120);
      return;
    }
    left -= 1;
    if (left > 0) window.setTimeout(() => requestAnimationFrame(tick), 120);
  };
  requestAnimationFrame(tick);
}
