/** Which surface of the reading screen a `ReaderSettings` row applies to. */
export type ReaderViewer = "epub" | "markdown" | "pdf";

/** Syntax/diagram theme override for Markdown code blocks and Mermaid
 *  diagrams. `null` = follow the app theme; otherwise a fixed light/dark
 *  rendering independent of the app theme. */
export type MarkdownBlockTheme = "light" | "dark";

export function normalizeBlockTheme(value: unknown): MarkdownBlockTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Row of the `ReaderSettings` table (one per book + viewer). The reader
 *  preferences that used to live in localStorage — EPUB/Markdown zoom, font
 *  and colors, and the PDF reading background — are stored per book here.
 *  `ReaderSettingsEntity.updatedAt` is excluded on purpose: hosts only ever
 *  read back what they wrote. */
export interface ReaderSettingsEntity {
  bookId: string;
  viewer: ReaderViewer;
  zoomPct: number;
  fontFamily: string;
  /** Custom background color override ("" / null = follow the app theme). */
  customBg: string | null;
  /** Custom text color override (null = follow the app theme). */
  customText: string | null;
  /** EPUB-only hard text-color override (1 = force `customText`/theme text
   *  color onto every element with `!important`, 0 = normal themed rules). */
  textHardOverride: number;
  /** PDF viewer background ("" / null = app default paper). */
  pdfBackground: string | null;
  /** Markdown-only code-block syntax theme ("light"/"dark", null = follow). */
  codeTheme: string | null;
  /** Markdown-only Mermaid diagram theme ("light"/"dark", null = follow). */
  diagramTheme: string | null;
  /** Markdown-only code-block background (null = follow the theme card). */
  codeBackground: string | null;
  /** Markdown-only diagram background (null = follow the theme card). */
  diagramBackground: string | null;
  updatedAt: string;
}