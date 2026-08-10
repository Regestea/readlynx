import type { BookSourceType } from "./types.ts";

/** Translation pipeline used to produce a cached row. */
export type TranslationMethod = "ocr" | "vision" | "chapter";

/** Row of the `Translations` table. PDF translations are keyed by
 *  `pageNumber`; EPUB translations are split into chunks, each row keyed by
 *  `chunkKey` (`<chapterId>#<index>`). */
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
