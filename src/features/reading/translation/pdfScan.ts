import { normalizeScanRegion } from "../../../infrastructure/db/entities/PdfScanRegion.ts";
import type { PdfScanRegion } from "../../../infrastructure/db/entities/PdfScanRegion.ts";
import type { PdfRegionBox } from "./pdfRegions.ts";

export { MIN_SCAN_REGION_FRACTION, normalizeScanRegion } from "../../../infrastructure/db/entities/PdfScanRegion.ts";
export type { PdfScanRegion } from "../../../infrastructure/db/entities/PdfScanRegion.ts";

/** PDF user units per inch — the denominator of every viewport scale. */
const POINTS_PER_INCH = 72;

/** Resolution every captured page is rendered at. Fixed, and the highest worth
 *  rendering: below this OCR starts losing small type, and the point of scanning
 *  a page instead of reading its text layer is that the type is hard to read. A
 *  vision model downscales anyway, so the cost is CPU and bandwidth, not
 *  accuracy. */
export const SCAN_CAPTURE_DPI = 600;

/** Viewport scale for `SCAN_CAPTURE_DPI`, independent of the on-screen zoom, so
 *  a capture never inherits whatever the reader has zoomed to. */
export function scanViewportScale(): number {
  return SCAN_CAPTURE_DPI / POINTS_PER_INCH;
}

/** True when the region covers the page, so capture code can skip cropping. */
export function isWholePageScanRegion(region: PdfScanRegion | null | undefined): boolean {
  return normalizeScanRegion(region) === null;
}

/** The region in the pixels of a `width` × `height` render, clamped and rounded
 *  to whole pixels. Same `{x, y, w, h}` shape as the numbered section boxes, so
 *  one cropping path serves both. */
export function scanRegionBox(
  region: PdfScanRegion | null | undefined,
  width: number,
  height: number,
): PdfRegionBox {
  const normalized = normalizeScanRegion(region);
  if (!normalized) {
    return {
      x: 0,
      y: 0,
      w: Math.max(1, Math.round(width)),
      h: Math.max(1, Math.round(height)),
    };
  }
  const x = Math.round(normalized.x * width);
  const y = Math.round(normalized.y * height);
  const right = Math.round((normalized.x + normalized.w) * width);
  const bottom = Math.round((normalized.y + normalized.h) * height);
  return {
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    w: Math.max(1, right - x),
    h: Math.max(1, bottom - y),
  };
}

/** Canvas offset that makes pdf.js paint only `box` of the page: `transform` is
 *  applied just before the viewport transform, so this shifts the page by the
 *  box origin — no resampling, and no pixels spent on the cut-off headers. */
export function scanRegionTransform(box: PdfRegionBox): number[] | undefined {
  if (box.x === 0 && box.y === 0) return undefined;
  return [1, 0, 0, 1, -box.x, -box.y];
}

/** Just the state, nothing else — the exact fractions are visible on the page. */
export function scanRegionLabel(region: PdfScanRegion | null | undefined): string {
  return normalizeScanRegion(region) === null ? "Whole page" : "Custom area";
}