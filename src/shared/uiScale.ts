/** Global interface scale (Settings → Display). Stored as a percent in the
 *  `AppSettings.uiScale` column and applied by the main process with
 *  `webContents.setZoomFactor`, so every window — readers included — scales
 *  the same way. Page zoom (unlike CSS zoom) also reaches EPUB iframes and
 *  re-rasterizes PDF canvases at the right density. */

/** Bounds the settings Select may offer and malformed stored values are
 *  clamped to. Every window shares one value: there is no per-window scale. */
export const UI_SCALE_MIN = 50;
export const UI_SCALE_MAX = 250;

/** The scale a fresh settings row starts at: unscaled. */
export const UI_SCALE_DEFAULT = 100;

/** Number-safe clamp: a non-numeric stored value collapses to the default
 *  instead of poisoning `setZoomFactor` with NaN. */
export function clampUiScale(percent: unknown): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, percent));
}
