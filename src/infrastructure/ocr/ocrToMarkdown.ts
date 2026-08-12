/** Turns raw OCR output into clean paragraphs separated by blank lines. */
export function ocrTextToMarkdown(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
  if (!normalized) return "";
  const blocks = normalized
    .split(/\n[ \t]*\n/)
    .map((block) => block.replace(/\n+/g, " ").trim())
    .filter(Boolean);
  return blocks.join("\n\n");
}
