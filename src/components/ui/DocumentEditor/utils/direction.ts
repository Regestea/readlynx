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
    (cp >= 0x06f0 && cp <= 0x06f9) // Extended Arabic-Indic (Persian) digits ۰-۹
  );
}

// Direction follows the DOMINANT language of the block, counted per WORD rather
// than per letter so a long Latin token can't drown out several short Persian
// words. Digits, spaces and punctuation are neutral and don't vote.
export function classifyWord(word: string): "rtl" | "ltr" | undefined {
  for (const ch of word) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue;
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  return undefined;
}

export function isRtlDominant(text: string): boolean {
  let rtlWords = 0;
  let ltrWords = 0;
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const cls = classifyWord(raw);
    if (cls === "rtl") rtlWords++;
    else if (cls === "ltr") ltrWords++;
  }
  if (rtlWords === ltrWords) {
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (isArabicDigit(cp)) continue;
      if (isRtlCodePoint(cp)) return true;
      if (/[a-zA-Z]/.test(ch)) return false;
    }
    return false;
  }
  return rtlWords > ltrWords;
}
