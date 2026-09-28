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
  /** Numbered page sections visible as red boxes on the PDF image
   *  (`id` + section kind). Only set for annotated vision requests — the
   *  model answers with `[REGION-n]` ids, never with coordinates. */
  regions?: Array<{ id: number; label: string }>;
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
  const hasCustomInstruction = (context.customPrompt ?? "").trim().length > 0;
  // Target "none" without a custom instruction means structure-only mode:
  // no translation, but messy structure may be cleaned. The words themselves
  // must never change — only Markdown structure around the unchanged text.
  const verbatim = noTarget && !hasCustomInstruction;

  if (verbatim) {
    if (context.docType === "PDF image") {
      const base = [
        "You are the formatting engine of a reading app.",
        "Transcribe all visible text on the provided page image EXACTLY as written, word for word, in its original language. Do not translate it into another language.",
        "Preserve the author's exact words, sentences, order, and details. Do not paraphrase, rewrite, summarize, simplify, modernize, or correct grammar/spelling/style — even if the writing looks messy, informal, repetitive, or dirty.",
        "Do not invent, omit, add, or reorder any words or sentences. Preserve the original reading order.",
        "Structure only: rebuild clean Markdown (paragraphs, headings, lists, tables, block quotes) around the unchanged words. If the page layout is already clean, keep it; if it is messy or broken, fix only the structure — never the wording.",
        "Do not add explanations, comments, or notes about the process. Return the content only.",
        "Return Markdown only. Do not wrap the whole response in a single code fence.",
      ];
      if (context.regions && context.regions.length > 0) {
        base.push(
          "The image shows red numbered boxes around each page section. Transcribe heading and text sections as normal Markdown text in numeric order. Where a figure, diagram or photo belongs in the flow, emit its token exactly as `[REGION-n]` on its own line and keep it verbatim — the app replaces it with the real image. An output with no images is fine; never invent a `[REGION-n]` id that was not listed.",
        );
      }
      return base.join("\n");
    }
    if (context.docType === "EPUB HTML") {
      return [
        "You are the formatting engine of a reading app.",
        "The input is the cleaned original HTML of a chapter, in its original language. Return it in that language, word for word. Do not translate it into another language.",
        "Preserve the author's exact words, sentences, order, tone, and details. Do not paraphrase, rewrite, summarize, shorten, expand, simplify, modernize, or correct grammar/spelling/style — even if the writing looks messy, informal, repetitive, or dirty.",
        "Do not invent, omit, add, or reorder any words, sentences, or paragraphs.",
        "Structure only: rebuild clean Markdown (paragraphs, headings, lists, tables, block quotes) around the unchanged text, using the HTML tags only to decide formatting. If the structure is already clean, keep it; if it is messy or broken, fix only the structure — never the wording.",
        "Use semantic tags (headings, paragraphs, lists, tables, quotes) and code markers (pre, code, data-code-language) to detect structure.",
        "Code inside pre or code elements is source code: put it inside fenced Markdown code blocks with the appropriate language (hinted by data-code-language), reproducing it completely and exactly — never truncate lines.",
        "Do not output any HTML tags or escaped tag entities like &lt;div&gt;. Return Markdown only. Do not wrap the whole response in a single code fence.",
        "Do not add explanations, comments, or notes. Return the content only.",
        "Keep every image placeholder such as [IMG-0] exactly as it is: do not translate, describe, explain, wrap, modify, or remove it.",
      ].join("\n");
    }
    if (context.docType === "Markdown") {
      return [
        "You are the formatting engine of a reading app.",
        "The input is one chunk of a Markdown document, in its original language. Return it in that language, word for word. Do not translate it into another language.",
        "Preserve the author's exact words, sentences, order, tone, and details. Do not paraphrase, rewrite, summarize, shorten, expand, simplify, modernize, or correct grammar/spelling/style — even if the writing looks messy, informal, repetitive, or dirty.",
        "Do not invent, omit, add, or reorder any words, sentences, or paragraphs.",
        "Structure only: rebuild clean Markdown (paragraphs, headings, lists, tables, block quotes, code blocks) around the unchanged text. If the source structure is already clean, keep it; if it is messy or broken, fix only the structure — never the wording.",
        "Keep Markdown images (`![alt](url)`) and links (`[text](url)`) intact in place with their URLs unchanged.",
        "Do not add explanations, comments, or notes. Return the content only.",
        "Return Markdown only. Do not wrap the whole response in a single code fence.",
      ].join("\n");
    }
    return [
      "You are the formatting engine of a reading app.",
      "Return the provided source content in its original language, word for word. Do not translate it into another language.",
      "Preserve the author's exact words, sentences, order, tone, and details. Do not paraphrase, rewrite, summarize, shorten, expand, simplify, modernize, or correct grammar/spelling/style — even if the writing looks messy, informal, repetitive, or dirty.",
      "Do not invent, omit, add, or reorder any words, sentences, or paragraphs.",
      "Structure only: rebuild clean Markdown (paragraphs, headings, lists, tables, block quotes) around the unchanged text. If the source structure is already clean, keep it; if it is messy or broken, fix only the structure — never the wording.",
      "Do not add explanations, comments, or notes. Return the content only.",
      "Return Markdown only. Do not wrap the whole response in a single code fence.",
      "Keep every image placeholder such as [IMG-0] exactly as it is: do not translate, describe, explain, wrap, modify, or remove it.",
    ].join("\n");
  }

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
        `Language lock — this is a hard requirement, not a preference: never answer in the source language, not even partially. If you catch yourself writing any sentence in another language, stop and rewrite it in ${target} before continuing. The only exception is executable source code, which is never translated.`,
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
    "",
    "Mermaid syntax rules (violating these makes the diagram fail to render):",
    "- ALWAYS wrap a node or edge label in double quotes if it contains any of `( ) [ ] { } | \"`. An unquoted label ends at the first closing bracket it contains, so `A[Step 1 (prepare)]` and `A -->|yes (go on)| B` are both parse errors; write `A[\"Step 1 (prepare)\"]` and `A -->|\"yes (go on)\"| B` instead.",
    "- Prefer Persian text in labels, and put any Latin gloss in parentheses inside the quoted label rather than outside the brackets.",
    "- Use `#quot;` (never a bare `\"`) if a quoted label itself needs a quotation mark.",
    "- Keep `%%` comments on their own line; never place one mid-line.",
    "- Never use `{` or `}` for grouping inside a label; they end the label early.",
    "- In a `pie` chart every slice label must be a quoted string, even when it has no special characters.",
    "- In an `erDiagram`, quote a relationship label that contains punctuation: `CUSTOMER ||--o{ ORDER : \"places (many)\"`.",
    "- In a `classDiagram`, parentheses in a member line are a parameter list, not a label; write `+run(x) : void` and do not quote inside the braces.",
    "- In a `quadrantChart` always list all four `quadrant-1` … `quadrant-4` entries, and write an axis as `x-axis <title> Low --> High`. Never wrap the range in parentheses: `x-axis A (Low --> High)` is a syntax error.",
    "- In a `quadrantChart`, quote a `quadrant-N` label when it contains brackets or parentheses: `quadrant-1 \"Standardised (NRT)\"`. Ampersands and commas need no quoting there.",
    "- NEVER mirror a node's brackets to match the reading direction of the surrounding Persian text. Mermaid is written left-to-right: write `A1[میانگین / Mean]`, never `]میانگین / Mean[A1`, and `subgraph \"چپسو (چولگی منفی)\"`, never `subgraph چپسو )چولگی منفی(`. The node id always comes first.",
    "- Do not nest a Mermaid diagram inside another one, and do not leave a diagram unfinished with a dangling arrow.",
    "",
    "Mermaid examples:",
    "A simple flow such as A → B → C may be represented as:",
    "```mermaid",
    "flowchart LR",
    "    A --> B --> C",
    "```",
    "Labels containing brackets or parentheses must be quoted:",
    "```mermaid",
    "flowchart TD",
    '    A["گروه اصلی (Core)"] --> B["تصمیم‌گیری (yes / no)"]',
    '    B -->|"بله (Yes)"| C["ادامه‌ی مسیر"]',
    '    B -->|"خیر (No)"| D["بازگشت"]',
    '    subgraph S1["مراحل (Steps)"]',
    '        E["مرحله‌ی ۱"]',
    "    end",
    "```",
    "A pie chart may be represented as:",
    "```mermaid",
    "pie",
    '    title Example',
    '    "A" : 40',
    '    "B" : 35',
    '    "C" : 25',
    "```",
    "A quadrant chart writes its axes without parentheses and quotes labels that contain them:",
    "```mermaid",
    "quadrantChart",
    '    title "مقایسه‌ی آزمون‌ها"',
    "    x-axis Washback & Authenticity Low --> High",
    "    y-axis Reliability & Practicality Low --> High",
    '    quadrant-1 "سنجش‌های بزرگ (NRT)"',
    '    quadrant-2 "آزمون‌های کوتاه (CRT)"',
    '    quadrant-3 "پوشه کار، مجلات"',
    '    quadrant-4 "روش‌های جایگزین"',
    "```",
  );

  if (context.docType === "PDF image") {
    lines.push(
        "The input is an image of a page. First read and understand all visible text and visual structure on the image, then translate and reconstruct the content as Markdown.",
    );
    if (context.regions && context.regions.length > 0) {
      lines.push(
        "Numbered sections:",
        "- The image shows red numbered boxes around each page section: headings, text blocks, figures/charts, tables.",
        "- Heading and text sections are ordinary translatable content: translate them as normal Markdown text in numeric (reading) order. Never turn text into an image, screenshot, or placeholder — easily translatable text always stays as translated text.",
        "- Only figures, diagrams, photos and charts that cannot be translated stay visual: where one belongs in the flow, emit its token exactly as `[REGION-n]` (e.g. `[REGION-3]`) on its own line. The app replaces the token with the real image. For boxed figure sections this overrides the Mermaid rules below — always use the token, never redraw the figure as Mermaid.",
        "- Do not describe images, do not transcribe text inside figures, and never invent coordinates.",
        "- Use each `[REGION-n]` token at most ONCE in the whole output. Repeating the same image multiple times is wrong — if a figure matters in two places, keep it where it first belongs and refer to it with words afterwards.",
        "- Never emit a token for a section whose content you already translated as text. Images are only for figures, diagrams, photos and charts — translated text never needs an image next to it.",
        "- An output with no images at all is perfectly fine — return translation only when nothing visual is needed. Never invent a `[REGION-n]` id that was not listed for this page.",
        "- Keep every `[REGION-n]` token exactly as it is: do not translate, wrap, modify, or remove it. Drop a token only when that section is pure decoration with no content value.",
      );
    }
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

  if (context.docType === "EPUB HTML") {
    lines.push(
        "The input is the cleaned original HTML of a chapter (scripts, styles, hidden content, and noisy attributes removed; images replaced by placeholders). Translate the text nodes in document order into clean Markdown.",
        "Use semantic tags (headings, paragraphs, lists, tables, quotes) only to decide structure.",
        "Never output HTML tags or escaped tag entities like &lt;div&gt; — the output must be Markdown only.",
        "Code inside pre or code elements is source code: do not translate it; put it inside fenced Markdown code blocks with the appropriate language (hinted by data-code-language), reproducing it completely and exactly.",
        "The input may contain image placeholders such as [IMG-0] between elements.",
        "Keep every image placeholder exactly as it is: do not translate, describe, explain, wrap, modify, or remove it.",
    );
  }

  if (context.docType === "Markdown") {
    lines.push(
        "The input is one chunk of a Markdown document (the full file is split into chunks of a few thousand characters so no request overloads the model; translate only this chunk, in order). Rebuild clean Markdown based on the structure and meaning of the source.",
        "Keep the document's Markdown structure: headings, paragraphs, lists, tables, block quotes, code blocks, links and images stay in the same order and positions.",
        "The input may contain code already marked as inline backticks or fenced blocks — keep short fragments inline and long/JSX/brace-heavy fragments as fenced blocks; if the input omitted code markers, infer them from the content and still produce the correct Markdown code formatting.",
        "Keep Markdown images (`![alt](url)`) and links (`[text](url)`) intact in place: translate only their human-readable text (alt/text), never the URL, and do not describe, wrap, modify, or remove them.",
        "Do not invent formatting that is not supported by the source, except for promoting long code that appeared inline in the source into a proper fenced block as described in the Code rules above.",
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
 * Follow-up repair for vision output that came back in the wrong language
 * (the model was busy placing image tokens and dropped the language
 * constraint). Text-only on purpose — no image to distract it this time.
 * Image tokens and code survive verbatim; everything else is rewritten in
 * the target language.
 */
export function buildLanguageRepairPrompts(targetLang: string): {
  system: string;
  user: (content: string) => string;
} {
  const target = languageLabel(targetLang);
  const system = [
    "You are the translation engine of a reading app.",
    `Rewrite the following Markdown entirely in ${target}. It was translated from another language but came out in the wrong language — your only job is to fix the language while preserving everything else.`,
    "Keep the exact same structure, order, headings, lists, tables and meaning. Do not summarize, shorten, or add explanations.",
    "Keep every `[REGION-n]` and `[IMG-n]` token exactly as it is, in the same place: do not translate, wrap, modify, or remove them. Use each token at most once; delete accidental duplicates.",
    "Do not translate executable source code — fenced code blocks stay exactly as they are.",
    "Return Markdown only. Do not wrap the whole response in a single code fence.",
    `Language lock: every word must be in ${target}. If you catch yourself writing another language, stop and rewrite in ${target}.`,
  ].join("\n");
  const user = (content: string): string =>
    `Rewrite the following Markdown entirely in ${target} according to the system instructions:\n\n${content}`;
  return { system, user };
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
  const verbatim =
    context.targetLang === NO_LANGUAGE && !customPrompt;
  const noTarget = context.targetLang === NO_LANGUAGE;
  const target = languageLabel(context.targetLang);

  const parts: string[] = [];

  // Restates the target language in the user message itself: vision models
  // anchor on the image's language, so a system-only instruction is what lets
  // source-language answers slip through.
  if (!verbatim && !noTarget) {
    parts.push(
      `Write the ENTIRE output in ${target}. Before finishing, verify every sentence is in ${target}; rewrite any part that came out in another language. Executable source code stays unchanged.`,
    );
  }

  if (customPrompt) {
    parts.push(
        "Additional user instruction:",
        customPrompt,
    );
  }

  if (context.docType === "PDF image") {
    const legend =
      context.regions && context.regions.length > 0
        ? `Sections on this page: ${context.regions.map((r) => `${r.id}=${r.label}`).join(", ")}.`
        : "";
    parts.push(
      verbatim
        ? `Transcribe the text and visual content visible in the provided image according to the system instructions. Keep every word exactly as written; fix only messy structure. ${legend}`.trim()
        : `Process the text and visual content visible in the provided image according to the system instructions. ${legend}`.trim(),
    );
  } else if (context.docType === "EPUB HTML") {
    parts.push(
      verbatim
        ? "Clean up only the structure of the following raw chapter HTML according to the system instructions. Keep every word exactly as written; never output HTML tags:"
        : "Convert the following raw chapter HTML to Markdown according to the system instructions:",
        content,
    );
  } else {
    parts.push(
      verbatim
        ? "Clean up only the structure of the following source content according to the system instructions. Keep every word exactly as written:"
        : "Process the following source content according to the system instructions:",
        content,
    );
  }

  return parts.join("\n\n");
}