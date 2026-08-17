/** Pure, framework-free service that owns the PDF reader background theme:
 *  an eye-friendly palette, localStorage persistence (fallback only — reading
 *  books persist per-book in the `ReaderSettings` DB table via
 *  `PdfThemeProvider`), and the DOM application (CSS custom properties). The
 *  React pieces (PdfThemeProvider, PdfThemeSettings, PdfViewer) build on top
 *  of it, so theming works without React too.
 *
 *  Themes are presentation-only: the PDF binary is never read for styling
 *  and never written. Everything happens through CSS variables on the
 *  viewer root element. The curated color set itself lives in the shared
 *  `ColorPickerPanel/colors` module so every reader offers the same colors. */

import { READING_BACKGROUNDS, READING_DEFAULT_BACKGROUND } from "../../ui/ColorPickerPanel/colors";

export interface PdfThemeBackground {
  /** Human-readable name shown in the picker. */
  name: string;
  /** The background color itself. */
  background: string;
  /** Whether the background is dark — the canvas gets inverted for
   *  readability. */
  dark: boolean;
}

export interface PdfThemeState {
  /** The reader background color. The text keeps its original look: on
   *  light papers the white page is tinted onto the color, on dark papers
   *  the canvas is inverted. */
  background: string;
}

/** Eye-friendly backgrounds: soft, low-glare papers and muted darks. */
export const PDF_THEME_BACKGROUNDS: PdfThemeBackground[] = READING_BACKGROUNDS.map(({ name, color }) => ({
  name: name ?? color,
  background: color,
  dark: isDarkBackground(color),
}));

/** The default background — a warm, low-glare paper instead of pure white. */
export const PDF_THEME_DEFAULT_BACKGROUND = READING_DEFAULT_BACKGROUND;

const DEFAULT_STORAGE_KEY = "readlynx:pdf-theme";

export function isValidHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

/** Reads the persisted background, tolerating missing or corrupt data and
 *  legacy payloads that carried extra theme fields. */
export function loadPdfTheme(storageKey: string = DEFAULT_STORAGE_KEY): PdfThemeState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { background: PDF_THEME_DEFAULT_BACKGROUND };
    const parsed = JSON.parse(raw) as Partial<PdfThemeState>;
    if (isValidHexColor(parsed.background ?? "")) {
      return { background: parsed.background! };
    }
    return { background: PDF_THEME_DEFAULT_BACKGROUND };
  } catch {
    return { background: PDF_THEME_DEFAULT_BACKGROUND };
  }
}

/** Persists the background. localStorage only — the PDF file is never touched. */
export function savePdfTheme(state: PdfThemeState, storageKey: string = DEFAULT_STORAGE_KEY): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage unavailable or full — keep working without persistence.
  }
}

/** Luminance check: a dark background needs the canvas inverted so the page
 *  stays readable. */
function isDarkBackground(background: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return false;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** CSS filter applied to the canvas layer. Dark pages are simulated with a
 *  pure CSS inversion — no pixel-by-pixel processing, no pdfjs re-render.
 *  Light pages are left untouched: the multiply tint overlay repaints them
 *  (see `--pdf-canvas-tint-opacity`), which maps the page's white onto the
 *  chosen background color exactly. */
export function canvasFilterFor(state: PdfThemeState): string {
  if (isDarkBackground(state.background)) {
    return "invert(0.92) hue-rotate(180deg) contrast(0.9)";
  }
  return "none";
}

/** Applies the background to the viewer element: sets the `data-pdf-theme`
 *  attribute (matched by the CSS in pdf-theme.css) and the
 *  `--pdf-background-color`, `--pdf-canvas-filter`,
 *  `--pdf-canvas-tint-opacity` and `--pdf-toolbar-color` custom properties
 *  inline. This is a pure style swap — nothing in pdfjs-dist re-renders,
 *  so theme changes stay instant even on multi-hundred-page documents. */
export function applyPdfTheme(element: HTMLElement, state: PdfThemeState): void {
  const filter = canvasFilterFor(state);
  const dark = filter !== "none";
  element.dataset.pdfTheme = dark ? "dark" : "light";
  element.style.setProperty("--pdf-background-color", state.background);
  element.style.setProperty("--pdf-canvas-filter", filter);
  // The tint overlay only applies when the canvas is not inverted — with
  // invert active, multiply would crush the page toward black.
  element.style.setProperty("--pdf-canvas-tint-opacity", dark ? "0" : "1");
  // Toolbar controls turn white on dark reader backgrounds so they stay
  // readable next to the dark page. Removing the variable for light
  // backgrounds makes the toolbar fall back to the normal app colors.
  if (dark) {
    element.style.setProperty("--pdf-toolbar-color", "#ffffff");
  } else {
    element.style.removeProperty("--pdf-toolbar-color");
  }
}