/**
 * The part of a PDF page that is scanned with OCR or sent to AI vision.
 *
 * Books repeat their running head, footer and page number on every page, so
 * without a cut-off each of those lines is recognized, translated and shown as
 * body text. Stored as page fractions (0..1) rather than pixels so one value
 * fits every page whatever its size or rotation; `null` means the whole page.
 *
 * Lives here because the DB layer validates it in both directions and the
 * reading view reuses the same rule — what it previews is what gets saved.
 */
export interface PdfScanRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest page fraction a region may keep on one axis — thinner is a slip of
 *  the mouse, not a selection, and would hold no text. */
export const MIN_SCAN_REGION_FRACTION = 0.01;

/** Within this distance of the full page counts as the whole page: cropping a
 *  hairline inset produces the very same image. */
const WHOLE_PAGE_EPSILON = 0.002;

/** Clamps a region into the page, or returns null when it is null, degenerate
 *  or effectively the whole page. Negative sizes normalize, so a rect dragged
 *  in any direction stores the same area. */
export function normalizeScanRegion(region: PdfScanRegion | null | undefined): PdfScanRegion | null {
  if (!region) return null;
  const { x, y, w, h } = region;
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return null;
  const left = Math.min(Math.max(0, Math.min(x, x + w)), 1);
  const top = Math.min(Math.max(0, Math.min(y, y + h)), 1);
  const right = Math.min(Math.max(0, Math.max(x, x + w)), 1);
  const bottom = Math.min(Math.max(0, Math.max(y, y + h)), 1);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_SCAN_REGION_FRACTION || height < MIN_SCAN_REGION_FRACTION) return null;
  if (width > 1 - WHOLE_PAGE_EPSILON && height > 1 - WHOLE_PAGE_EPSILON) return null;
  return { x: left, y: top, w: width, h: height };
}