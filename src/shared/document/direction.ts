/**
 * Text direction heuristics.
 *
 * Direction follows the DOMINANT language of the block, counted per WORD
 * rather than per letter so a long Latin token can't drown out several short
 * Persian words. Digits, spaces and punctuation are neutral and don't vote.
 *
 * Pure text analysis — no DOM, no editor — so the reader, the exporters and
 * the editor's markdown import all share one implementation.
 */

export function isRtlCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x05ff) || // Hebrew
    (cp >= 0x0600 && cp <= 0x06ff) || // Arabic
    (cp >= 0x0750 && cp <= 0x077f) || // Arabic Supplement
    (cp >= 0xfb50 && cp <= 0xfdff) || // Arabic Presentation Forms-A
    (cp >= 0xfe70 && cp <= 0xfeff) // Arabic Presentation Forms-B
  );
}

export function isArabicDigit(cp: number): boolean {
  return (
    (cp >= 0x0660 && cp <= 0x0669) || // Arabic-Indic digits ٠-٩
    (cp >= 0x06f0 && cp <= 0x06f9) // Extended Arabic-Indic digits ۰-۹
  );
}

export function classifyWord(word: string): "rtl" | "ltr" | undefined {
  for (const ch of word) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue;
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  return undefined;
}

/**
 * Whether a block should be laid out right-to-left.
 *
 * Delegates to `getTextDir` on purpose: this used to be a second, slightly
 * different copy of the same heuristic, and the two drifted. The DOCX writer
 * picks its paragraph direction from here while the reader, the PDF and the
 * EPUB use `getTextDir`, so a disagreement meant the same page laid out in a
 * different order depending on the format — a paragraph starting with a
 * Persian digit was the clearest case.
 */
export function isRtlDominant(text: string): boolean {
  return getTextDir(text) === "rtl";
}

/**
 * Direction of one block of text: `"rtl"`, `"ltr"`, or `undefined` when there
 * is no text to judge (the page default then applies, which matters for a block
 * whose only content is an image).
 *
 * The leading-character rule matters: a paragraph that opens with a Persian
 * or Arabic digit ("۱…", "۰۲…") is conventionally Persian and aligns right
 * regardless of what follows. Shared by the Markdown reader and every export
 * writer so a translated block lays out identically in both.
 */
export function getTextDir(text: string): "rtl" | "ltr" | undefined {
  const lead = text.trim();
  if (!lead) return undefined;
  const leadCp = lead.codePointAt(0) ?? 0;
  if (isArabicDigit(leadCp)) return "rtl";
  if (isRtlCodePoint(leadCp)) return "rtl";
  let rtlWords = 0;
  let ltrWords = 0;
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const cls = classifyWord(raw);
    if (cls === "rtl") rtlWords++;
    else if (cls === "ltr") ltrWords++;
  }
  if (rtlWords > ltrWords) return "rtl";
  if (ltrWords > rtlWords) return "ltr";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue;
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  // Digits and punctuation only, e.g. an ordered list of decimals sitting in a
  // Persian book. Unicode resolves a paragraph with no strong character to
  // level 0 (LTR) rather than borrowing the surrounding text, and
  // `isRtlDominant` already treats such text as non-RTL. Deferring to the page
  // direction here was the one case where the two disagreed, and it put the
  // list markers and the decimal points on the wrong side.
  return "ltr";
}

/** The CSS text-alignment that goes with a direction. */
export function textAlignForDir(dir: "rtl" | "ltr" | undefined): "right" | "left" | undefined {
  return dir === "rtl" ? "right" : dir === "ltr" ? "left" : undefined;
}
