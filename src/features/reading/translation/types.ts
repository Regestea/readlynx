import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import type { TranslationMethod } from "../../../infrastructure/db/entities/Translation.ts";

export type { TranslationMethod } from "../../../infrastructure/db/entities/Translation.ts";

export type { BookSourceType };

/** What the reading screen shows in the viewer area. */
export type TranslationViewMode = "original" | "translation";

/** What the AI was asked to translate (part of every request). */
export type TranslationDocType = "EPUB chapter" | "PDF OCR text" | "PDF image";

/** Per-book translation preferences (mirrors the `ReadingState` columns). */
export interface TranslationSettings {
  /** Tesseract language codes used to OCR PDF pages. */
  ocrLangs: string[];
  /** Target language code (shared by OCR and AI vision pipelines). */
  targetLang: string;
  /** Effective custom instruction text sent to the model ("" = none). */
  customPrompt: string;
  /** Id of the chosen AI model ("" = the app default model). */
  modelId: string;
  /** Id of the chosen saved instruction ("" = no instruction). */
  customPromptId: string;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  ocrLangs: ["eng"],
  targetLang: "en",
  customPrompt: "",
  modelId: "",
  customPromptId: "",
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