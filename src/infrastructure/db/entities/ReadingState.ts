/** Row of the `ReadingState` table (one per book). Besides the reading
 *  position it stores the per-book translation settings: OCR languages
 *  (`ocrLangs` is a JSON array of tesseract codes), the AI source/target
 *  languages and the default custom prompt. */
export interface ReadingStateEntity {
  bookId: string;
  currentPage: number;
  scrollPosition: number;
  ocrLangs: string[];
  sourceLang: string;
  targetLang: string;
  customPrompt: string;
  updatedAt: string;
}
