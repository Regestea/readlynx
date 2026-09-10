import type { TranslationDocType } from "./types.ts";
import { NO_LANGUAGE, languageLabel } from "./languages.ts";

export interface TranslationPromptContext {
  docType: TranslationDocType;
  /** Tesseract codes used when OCR was performed. */
  ocrLangs?: string[];
  /** Target language code. */
  targetLang: string;
  /** Optional user instruction layered on top of the default translation behavior. */
  customPrompt?: string;
}

/**
 * The behaviour contract sent to the model on every translation request.
 *
 * Important:
 * - The source language is intentionally NOT provided.
 * - The model should detect the source language from the actual content.
 * - The target language is provided explicitly by the application.
 * - Custom instructions are sent separately as a user-level instruction.
 */
export function buildTranslationSystemPrompt(
    context: TranslationPromptContext,
): string {
  const target = languageLabel(context.targetLang);
  const noTarget = context.targetLang === NO_LANGUAGE;

  const lines = [
    "You are the translation engine of a reading app.",
    noTarget
      ? "Process the source content in its original language. Do not translate it into another language."
      : `Translate the source content into ${target}.`,
    "Detect the source language automatically from the actual content. Do not assume a source language in advance.",
    "Translate faithfully and naturally while preserving the meaning, context, terminology, and important details of the source.",
    "Do not invent information that is not present in the source.",
    "Do not summarize, shorten, or omit content unless the user's instruction explicitly asks you to do so.",
  ];

  if (!noTarget) {
    lines.push(
        `The output must be written entirely in ${target}: headings, paragraphs, lists, table cells, captions, and notes. Do not leave any part of the source untranslated and do not mix in words from the source language. If the source is already in ${target}, return it in ${target} as-is.`,
    );
  }

  lines.push(
    "Output rules:",
    "- Return Markdown only.",
    "- Do not wrap the whole response in a single code fence.",
    "- Do not add explanations about the translation process outside the requested content.",
    "- Preserve useful document structure whenever the source supports it: headings, paragraphs, lists, tables, block quotes, code blocks, diagrams, and charts.",

    "Code:",
    "- Do not translate executable source code.",
    "- Preserve code as code whenever possible.",
    "- Put code inside fenced Markdown code blocks with the appropriate language.",
    "- Reproduce fenced code blocks from the source completely and exactly, line by line — never truncate, summarize, or omit lines of code.",
    "- Use inline backticks only for short identifiers, commands, or code fragments inside normal text (typically under ~40 characters, no JSX/brackets/semicolons/newlines).",
    "- If the source contains code that is long, contains JSX/HTML tags, braces, semicolons, arrow functions, or spans multiple tokens/lines, always use a fenced block — even if the source showed it inline. Promote long inline code to a fenced block.",
    "- Detect code by its content (keywords like function/return/export/import/const, JSX tags, braces, etc.), not only by backticks or fences — EPUBs are inconsistent and code may appear without markers.",
    "- Preserve URLs, file paths, identifiers, commands, API names, version numbers, and similar technical tokens when appropriate.",
    "- Example — a single-line component that looks short but contains JSX/brackets must be a block, not inline:",
    "  Incorrect: `export function important() { return <div>This is really important!</div>; }`",
    "  Correct:",
    "  ```tsx",
    "  export function important() { return <div>This is really important!</div>; }",
    "  ```",

    "Mermaid and charts:",
    "- When the source contains a diagram or chart that can be meaningfully represented with Mermaid, prefer converting it into a Mermaid diagram instead of replacing it with a plain-text description.",
    "- Preserve the meaning, relationships, hierarchy, labels, and data from the source as accurately as possible.",
    "- Use the most appropriate Mermaid diagram type for the source.",
    "- Put every Mermaid diagram inside a fenced Markdown code block using the `mermaid` language.",
    "- Do not omit a diagram merely because its exact visual styling cannot be reproduced.",
    "- Do not invent relationships, labels, values, or data that are not supported by the source.",
    "- Supported Mermaid visualizations include flowcharts, sequence diagrams, class diagrams, state diagrams, entity relationship diagrams, mind maps, timelines, journey diagrams, Gantt charts, pie charts, quadrant charts, and other Mermaid-compatible diagram types.",
    "- Pie charts should use Mermaid `pie` syntax when the source contains a pie chart.",
    "- Quadrant charts should use Mermaid quadrant syntax when the source contains a suitable quadrant chart.",
    "- If a diagram or chart cannot be represented faithfully with Mermaid, preserve its important information as Markdown rather than inventing an inaccurate diagram.",

    "Mermaid examples:",
    "A simple flow such as A → B → C may be represented as:",
    "```mermaid",
    "flowchart LR",
    "    A --> B --> C",
    "```",
    "A pie chart may be represented as:",
    "```mermaid",
    "pie",
    '    title Example',
    '    "A" : 40',
    '    "B" : 35',
    '    "C" : 25',
    "```",
  );

  if (context.docType === "PDF image") {
    lines.push(
        "The input is an image of a page. First read and understand all visible text and visual structure on the image, then translate and reconstruct the content as Markdown.",
    );
  }

  if (context.docType === "PDF OCR text") {
    lines.push(
        "The input is text extracted from a page using OCR. Correct obvious OCR artifacts when the intended text is clear from context, but do not invent missing content.",
    );
  }

  if (context.docType === "EPUB chapter") {
    lines.push(
        "The input is the plain text of a chapter with minimal structural markers. Reconstruct clean Markdown based on the structure and meaning of the source.",
        "Do not invent formatting that is not supported by the source, except for promoting long code that appeared inline in the source into a proper fenced block as described in the Code rules above.",
        "The input may contain code already marked as inline backticks or fenced blocks — keep short fragments inline and long/JSX/brace-heavy fragments as fenced blocks; if the input omitted code markers, infer them from the content and still produce the correct Markdown code formatting.",
        "The input may contain image placeholders such as [IMG-0] between paragraphs.",
        "Keep every image placeholder exactly as it is: do not translate, describe, explain, wrap, modify, or remove it.",
    );
  }

  lines.push(
      noTarget
        ? "The user may provide an additional instruction describing how they want the content processed, such as summarization, simplification, explanation, restructuring, tone, or level of detail. Follow that instruction as part of the requested transformation while keeping the content in its original language and preserving valid Markdown output."
        : "The user may provide an additional instruction describing how they want the content processed, such as summarization, simplification, explanation, restructuring, tone, or level of detail. Follow that instruction as part of the requested transformation while still using the application-provided target language and preserving valid Markdown output.",
  );

  return lines.join("\n");
}

/**
 * The user-level request sent to the model.
 *
 * This is intentionally separate from the system prompt so that
 * custom user instructions can modify the transformation without
 * becoming part of the application's core behaviour contract.
 */
export function buildTranslationUserPrompt(
    context: TranslationPromptContext,
    content: string,
): string {
  const customPrompt = context.customPrompt?.trim();

  const parts: string[] = [];

  if (customPrompt) {
    parts.push(
        "Additional user instruction:",
        customPrompt,
    );
  }

  if (context.docType === "PDF image") {
    parts.push(
        "Process the text and visual content visible in the provided image according to the system instructions.",
    );
  } else {
    parts.push(
        "Process the following source content according to the system instructions:",
        content,
    );
  }

  return parts.join("\n\n");
}