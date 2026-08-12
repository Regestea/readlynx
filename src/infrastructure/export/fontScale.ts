/**
 * Global font-size scaling for exports.
 *
 * The document's own text carries the sizes the author chose (e.g. 18px
 * headings, 14px paragraphs). A scale of 0% keeps them exactly as authored;
 * 10% multiplies every size by 1.1 — inline `font-size` declarations and the
 * base size for unstyled text alike.
 */

export function fontScaleFactor(scalePct: number | undefined): number {
  const pct = Number(scalePct) || 0;
  return (100 + Math.max(0, pct)) / 100;
}

function formatScaled(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** Multiply every inline `font-size: <n>px|pt` declaration by the scale. */
export function scaleHtmlFontSizes(html: string, scalePct: number | undefined): string {
  const factor = fontScaleFactor(scalePct);
  if (factor === 1) return html;
  return html.replace(/font-size:\s*([\d.]+)(px|pt)/gi, (_match, size: string, unit: string) => {
    const scaled = Number(size) * factor;
    return `font-size:${formatScaled(scaled)}${unit}`;
  });
}

/** Base font size (CSS px) for unstyled text, scaled; "" when no scaling. */
export function scaledBaseFontSize(scalePct: number | undefined, basePx = 16): string {
  const factor = fontScaleFactor(scalePct);
  return factor === 1 ? "" : `${formatScaled(basePx * factor)}px`;
}
