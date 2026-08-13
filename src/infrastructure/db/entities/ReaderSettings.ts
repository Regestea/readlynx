/** Which surface of the reading screen a `ReaderSettings` row applies to. */
export type ReaderViewer = "epub" | "markdown" | "pdf";

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
  /** PDF viewer background ("" / null = app default paper). */
  pdfBackground: string | null;
  updatedAt: string;
}