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
  /** When the book was last opened (drives "continue reading" ordering). */
  lastOpenedAt: string;
  updatedAt: string;
}