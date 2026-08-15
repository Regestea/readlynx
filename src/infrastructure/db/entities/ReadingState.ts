/** Row of the `ReadingState` table (one per book). Besides the reading
 *  position it stores the per-book translation settings: OCR languages
 *  (`ocrLangs` is a JSON array of tesseract codes), the AI target language
 *  and the chosen saved instruction / AI model. The position is tracked per
 *  source type: PDF books remember `currentPage`, EPUB books remember
 *  `currentChapter` (the spine index of the section being read). */
export interface ReadingStateEntity {
  bookId: string;
  /** Last PDF page read (1-based). EPUB books keep this at 1. */
  currentPage: number;
  /** Last EPUB chapter read (spine index as a string). PDF books keep "".
   *  Matches the chunk-key prefix used for chapter translations. */
  currentChapter: string;
  ocrLangs: string[];
  sourceLang: string;
  targetLang: string;
  /** Chosen AI model id ("" = app default). */
  modelId: string;
  /** Chosen saved instruction id ("" = no instruction). */
  customPromptId: string;
  /** PDF translation pipeline ("ocr" = tesseract + AI, "vision" = AI
   *  reads the page image directly). Irrelevant for EPUB books. */
  pdfMethod: "ocr" | "vision";
  /** Ordered AI model ids used for translation, in failover order (the next
   *  one takes over when the previous fails; empty = app default). The
   *  legacy single-choice `modelId` column still exists for old readers. */
  modelIds: string[];
  /** Total pages of the source PDF (0 until the document is opened). */
  totalPages: number;
  /** Total chapters of the source EPUB (0 until the book is opened). */
  totalChapters: number;
  /** Real reading progress 0..1 for EPUB books (epubjs location percentage,
   *  proportional to content). PDF books leave this at 0 — they progress by
   *  `currentPage / totalPages` instead. */
  progressPercent: number;
  /** Highest position reached (0..1, monotonic — never goes down). For PDF
   *  books it is `currentPage / totalPages` at its highest; for EPUB books
   *  the highest `progressPercent`. */
  maxProgress: number;
  /** 1 when the book was closed at >= 95% (content typically ended before
   *  the file's tail). Cleared when the book is opened again, so it can
   *  return to the reading-progress list. */
  finished: number;
  /** When the book was last opened (drives "continue reading" ordering). */
  lastOpenedAt: string;
  updatedAt: string;
}