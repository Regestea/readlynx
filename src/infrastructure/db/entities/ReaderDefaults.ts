import type { ReaderViewer } from "./ReaderSettings.ts";

/** Row of the `ReaderDefaults` table (one per viewer). Global fallback used
 *  for books that have no per-book `ReaderSettings` row yet — i.e. newly
 *  added books whose font/zoom/colors were never customized. Per-book values
 *  always win over these defaults. */
export interface ReaderDefaultsEntity {
  viewer: ReaderViewer;
  zoomPct: number;
  fontFamily: string;
  /** Custom background color override ("" / null = follow the app theme). */
  customBg: string | null;
  /** Custom text color override (null = follow the app theme). */
  customText: string | null;
  /** EPUB-only hard text-color override (1 = force onto every element). */
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
