import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import type { TranslationMethod } from "../../../infrastructure/db/entities/Translation.ts";

export type { TranslationMethod } from "../../../infrastructure/db/entities/Translation.ts";

export type { BookSourceType };

/** What the reading screen shows in the viewer area. */
export type TranslationViewMode = "original" | "translation";

/** What the AI was asked to translate (part of every request). */
export type TranslationDocType = "EPUB chapter" | "EPUB HTML" | "PDF OCR text" | "PDF image";

/** Which EPUB extraction is sent to the AI: converted Markdown (default) or
 *  the chapter's cleaned original HTML tags. */
export type EpubExtractionMode = "markdown" | "html";

/** Per-book translation preferences (mirrors the `ReadingState` columns). */
export interface TranslationSettings {
  /** Tesseract language codes used to OCR PDF pages. */
  ocrLangs: string[];
  /** Target language code (shared by OCR and AI vision pipelines). */
  targetLang: string;
  /** Id of the chosen saved instruction ("" = no instruction). The prompt
   *  text itself lives in the `CustomInstructions` table and is resolved by
   *  id when a translation runs. */
  customPromptId: string;
  /** Ordered AI model ids used for translation, in failover order: when a
   *  request fails with the current model, the next one in the list retries
   *  it. Empty = the app default model. */
  modelIds: string[];
  /** PDF pipeline ("ocr" = tesseract + AI, "vision" = AI reads the page
   *  image directly); EPUB books always use `chapter`. */
  pdfMethod: TranslationMethod;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  ocrLangs: ["eng"],
  targetLang: "en",
  modelIds: [],
  customPromptId: "",
  pdfMethod: "ocr",
};

/** Identifies the unit of content currently on screen: `pdf:<page>` or
 *  `epub:<chapter spine index>`. */
export type TranslationUnitKey = `pdf:${number}` | `epub:${string}`;

export function pdfUnitKey(pageNumber: number): TranslationUnitKey {
  return `pdf:${pageNumber}`;
}

export function epubUnitKey(chapterKey: string): TranslationUnitKey {
  return `epub:${chapterKey}`;
}

export function unitToPage(key: TranslationUnitKey): number | null {
  if (!key.startsWith("pdf:")) return null;
  const page = Number(key.slice(4));
  return Number.isFinite(page) ? page : null;
}

export function unitToChapter(key: TranslationUnitKey): string | null {
  if (!key.startsWith("epub:")) return null;
  return key.slice(5);
}

/** The translation pipeline the user picked for a PDF (EPUB always uses
 *  `chapter`). */
export function methodFor(sourceType: BookSourceType, pdfMethod: TranslationMethod): TranslationMethod {
  return sourceType === "epub" ? "chapter" : pdfMethod;
}

export function docTypeFor(
  sourceType: BookSourceType,
  pdfMethod: TranslationMethod,
): TranslationDocType {
  if (sourceType === "epub") return "EPUB chapter";
  return pdfMethod === "vision" ? "PDF image" : "PDF OCR text";
}