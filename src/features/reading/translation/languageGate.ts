import { NO_LANGUAGE } from "./languages.ts";

/**
 * Post-generation safety net for the PDF vision pipeline: when the model is
 * busy placing image tokens it sometimes drops the target-language
 * constraint and answers in the source language. This gate detects that
 * case with a script-ratio heuristic so the pipeline can run one text-only
 * repair pass.
 *
 * Deliberately conservative — it only FAILS long texts that are clearly in
 * the wrong script. Short texts, code-heavy pages and unmapped languages
 * always pass so a correct translation is never "repaired" by mistake.
 */

/** Unicode scripts each target language's prose is written in. */
const TARGET_SCRIPTS: Record<string, string[]> = {
  en: ["Latin"],
  fr: ["Latin"],
  de: ["Latin"],
  es: ["Latin"],
  it: ["Latin"],
  pt: ["Latin"],
  nl: ["Latin"],
  sv: ["Latin"],
  da: ["Latin"],
  no: ["Latin"],
  fi: ["Latin"],
  pl: ["Latin"],
  cs: ["Latin"],
  ro: ["Latin"],
  hu: ["Latin"],
  tr: ["Latin"],
  vi: ["Latin"],
  id: ["Latin"],
  ms: ["Latin"],
  eo: ["Latin"],
  la: ["Latin"],
  fa: ["Arabic"],
  ar: ["Arabic"],
  ur: ["Arabic"],
  ru: ["Cyrillic"],
  uk: ["Cyrillic"],
  zh: ["Han"],
  "zh-Hant": ["Han"],
  ja: ["Han", "Hiragana", "Katakana"],
  ko: ["Hangul", "Han"],
  he: ["Hebrew"],
  el: ["Greek"],
  th: ["Thai"],
  hi: ["Devanagari"],
  mr: ["Devanagari"],
  ne: ["Devanagari"],
  bn: ["Bengali"],
  ta: ["Tamil"],
  te: ["Telugu"],
  gu: ["Gujarati"],
  kn: ["Kannada"],
  ml: ["Malayalam"],
  si: ["Sinhala"],
};

/** Below this many letters the text is too short to judge — always passes. */
const MIN_LETTERS = 120;
/** Below this share of expected-script letters the output is flagged. */
const MIN_EXPECTED_RATIO = 0.35;

/** Removes everything that is not translated prose: code, tokens, links. */
function stripNonProse(markdown: string): string {
  return markdown
    .replace(/````[\s\S]*?````|```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\[REGION-\d+\]|\[IMG-\d+\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ");
}

/** True when the markdown looks like the target language (or cannot tell). */
export function passesLanguageGate(markdown: string, targetLang: string): boolean {
  if (!markdown || targetLang === NO_LANGUAGE) return true;
  const scripts = TARGET_SCRIPTS[targetLang];
  if (!scripts) return true;
  const prose = stripNonProse(markdown);
  const letters = prose.match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS) return true;
  let expected = 0;
  for (const script of scripts) {
    expected += prose.match(new RegExp(`\\p{Script=${script}}`, "gu"))?.length ?? 0;
  }
  return expected / letters.length >= MIN_EXPECTED_RATIO;
}
