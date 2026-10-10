/** How the PDF viewer expresses zoom, shared by the reader, the Settings page
 *  and the `ReaderSettings` / `ReaderDefaults` rows.
 *
 *  A PDF's zoom is stored as a percentage of the **fitted** page — the size
 *  the viewer picks automatically for the reading pane — not of the PDF's
 *  natural size, so 100% means "exactly what fits". That is also the value a
 *  book has before anyone touches it, which is what makes the global default
 *  in Settings work: a book whose stored zoom is still 100% has never been
 *  zoomed by hand and keeps following the default, exactly like the EPUB and
 *  translation readers.
 *
 *  A relative value is the only one that keeps its meaning. The fitted size
 *  changes with the window, the monitor and the reader pane, so a scale saved
 *  on one screen would open absurdly small or absurdly large on the next. It
 *  also means a pane resize (window drag, fullscreen, sidebar toggle) keeps
 *  the reading size the reader chose instead of throwing it away. */

/** Percent of the fitted page that a book opens at when nothing was ever
 *  chosen: the automatic fit. */
export const PDF_ZOOM_DEFAULT_PCT = 100;
export const PDF_ZOOM_MIN_PCT = 50;
export const PDF_ZOOM_MAX_PCT = 300;
export const PDF_ZOOM_STEP_PCT = 10;

/** pdf.js renders at whatever scale it is handed. These bound the canvas so a
 *  zoomed-out page stays legible and a zoomed-in one cannot ask for a bitmap
 *  far larger than any display could show. */
export const PDF_SCALE_MIN = 0.1;
export const PDF_SCALE_MAX = 3;

/** Normalizes a stored or entered percentage into the range the stepper and
 *  the toolbar can express. Non-numeric input falls back to the default. */
export function clampPdfZoomPct(zoomPct: number): number {
  if (!Number.isFinite(zoomPct)) return PDF_ZOOM_DEFAULT_PCT;
  return Math.min(PDF_ZOOM_MAX_PCT, Math.max(PDF_ZOOM_MIN_PCT, Math.round(zoomPct)));
}

/** Bounds the scale the automatic fit produced, for the same reason the
 *  rendered scale is bounded: a pane narrower than the page must not ask
 *  pdf.js for an absurdly small canvas. */
export function clampPdfFitScale(fittedScale: number): number {
  return Math.max(PDF_SCALE_MIN, Math.min(PDF_SCALE_MAX, fittedScale));
}

/** Turns a stored percentage into the pdf.js scale to render at, given the
 *  scale the automatic fit produced for the current pane. */
export function pdfScaleForZoom(fittedScale: number, zoomPct: number): number {
  return clampPdfFitScale(fittedScale * (clampPdfZoomPct(zoomPct) / 100));
}