import type { BookSourceType } from "./types.ts";

/** Translation pipeline used to produce a cached row. */
export type TranslationMethod = "ocr" | "vision" | "chapter";

/** Row of the `Translations` table, one per unit of content: PDF rows are
 *  keyed by `pageNumber` (with an empty `chunkKey`); EPUB translations are
 *  split into chunks, each row keyed by `chunkKey` (`<chapterId>#<index>`).
 *  The `method` column only records the pipeline that produced the row —
 *  it does not participate in uniqueness, so a page keeps a single
 *  translation whatever pipeline regenerated it. */
export interface TranslationEntity {
  id: string;
  bookId: string;
  sourceType: BookSourceType;
  method: TranslationMethod;
  pageNumber: number | null;
  chunkKey: string | null;
  sourceLang: string;
  targetLang: string;
  customPrompt: string;
  markdown: string;
  updatedAt: string;
}
