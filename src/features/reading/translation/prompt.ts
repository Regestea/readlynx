import type { TranslationDocType } from "./types.ts";
import { languageLabel, ocrLanguagesLabel } from "./languages.ts";

export interface TranslationPromptContext {
  docType: TranslationDocType;
  /** Tesseract codes of the OCR page, when `docType` is "PDF OCR text". */
  ocrLangs?: string[];
  /** Target language code. */
  targetLang: string;
  /** Optional user instruction layered on top of translation. */
  customPrompt?: string;
}

function sourceDescription(context: TranslationPromptContext): string {
  if (context.docType === "PDF OCR text" && context.ocrLangs?.length) {
    const langs = ocrLanguagesLabel(context.ocrLangs);
    return `the text extracted from the page (recognized as ${langs})`;
  }
  return "the source language (detected automatically from the content)";
}

/** The behaviour contract sent to the model on every translation request. */
export function buildTranslationSystemPrompt(context: TranslationPromptContext): string {
  const source = sourceDescription(context);
  const target = languageLabel(context.targetLang);
  const lines = [
    "You are the translation engine of a reading app. You translate pages and chapters that the user is reading.",
    `Translate the content from ${source} to ${target}.`,
    "Output rules:",
    "- Return Markdown only. Do not wrap the whole response in code fences and do not add any explanation outside the Markdown.",
    "- Preserve useful structure whenever the source has it: headings, paragraphs, lists, tables, code blocks and block quotes.",
    "- Translate code as code: put any code in a fenced code block annotated with its language (```language ... ```). Never write code as plain text, and use inline backticks (`code`) only for short identifiers inside a sentence.",
    "- Do not summarize, shorten or omit content unless the user's instruction asks you to.",
    "- The user instruction below is an extra layer that overrides the default \"translate normally\" behaviour when it conflicts.",
  ];
  if (context.docType === "PDF image") {
    lines.splice(
      1,
      0,
      "The input is an image of a page. Read all the text on the image first, then translate it into Markdown, preserving headings, paragraphs, lists, tables and code blocks as best as the image allows.",
    );
  }
  if (context.docType === "EPUB chapter") {
    lines.splice(
      1,
      0,
      "The input is the plain text of a chapter with only minimal structural markers (# for headings, - for lists, > for quotes). Rebuild the chapter as clean Markdown: translate all text and use headings, paragraphs, lists, tables and block quotes where the source implies them. Do not copy or invent any formatting symbols.",
    );
    lines.splice(
      2,
      0,
      "The input may contain image placeholders like [IMG-0] between paragraphs. Keep every placeholder exactly as it is: do not translate, describe, explain, wrap or remove it — the image itself is rendered separately.",
    );
  }
  if (context.customPrompt?.trim()) {
    lines.push(`User instruction: ${context.customPrompt.trim()}`);
  }
  return lines.join("\n");
}

/** The text (or, for images, the instruction) sent as the user message. */
export function buildTranslationUserPrompt(
  context: TranslationPromptContext,
  content: string,
): string {
  if (context.docType === "PDF image") {
    return "Translate the text visible in the image according to your instructions.";
  }
  return content;
}