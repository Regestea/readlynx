/** Row of the `ReadingState` table (one per book). Besides the reading
 *  position it stores the per-book translation settings: OCR languages
 *  (`ocrLangs` is a JSON array of tesseract codes), the AI target language,
 *  the chosen custom prompt and the chosen AI model. */
export interface ReadingStateEntity {
  bookId: string;
  currentPage: number;
  scrollPosition: number;
  ocrLangs: string[];
  sourceLang: string;
  targetLang: string;
  customPrompt: string;
  /** Chosen AI model id ("" = app default). */
  modelId: string;
  /** Chosen saved instruction id ("" = no instruction). */
  customPromptId: string;
  updatedAt: string;
}