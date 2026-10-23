/** How a PDF book lays out its pages, shared by the reader toolbar, the
 *  Settings defaults card and the `ReaderSettings` / `ReaderDefaults` rows.
 *
 *  "scroll" renders the whole document as one continuous, virtualized column
 *  (the reading experience of a web page); "paged" renders one page at a time
 *  (the classic PDF reader). The choice is stored per book — like the zoom and
 *  the reading background — so a book always reopens the way it was left.
 *  A null column value means "never chosen": the global `ReaderDefaults` row
 *  wins, then the built-in default below. */

export type PdfDisplayMode = "scroll" | "paged";

/** What a book opens at when no per-book or global choice was ever made. */
export const PDF_DISPLAY_MODE_DEFAULT: PdfDisplayMode = "scroll";

/** Normalizes a stored column value; null when absent or unknown, which the
 *  loader turns into "follow the next fallback". */
export function normalizePdfDisplayMode(value: unknown): PdfDisplayMode | null {
  return value === "scroll" || value === "paged" ? value : null;
}
