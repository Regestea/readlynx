export const DEFAULT_FONT_SIZE_VALUE = "14px";

export const FONT_SIZE_OPTIONS = [
  { value: "12px", label: "12px" },
  { value: "14px", label: "14px" },
  { value: "16px", label: "16px" },
  { value: "18px", label: "18px" },
  { value: "20px", label: "20px" },
  { value: "24px", label: "24px" },
  { value: "28px", label: "28px" },
  { value: "32px", label: "32px" },
  { value: "36px", label: "36px" },
  { value: "40px", label: "40px" },
  { value: "44px", label: "44px" },
  { value: "48px", label: "48px" },
  { value: "52px", label: "52px" },
  { value: "56px", label: "56px" },
  { value: "60px", label: "60px" },
  { value: "64px", label: "64px" },
  { value: "68px", label: "68px" },
  { value: "72px", label: "72px" },
] as const;

export const TEXT_COLORS = [
  { value: "", label: "Default", swatch: "transparent" },
  { value: "#322b26", label: "Ink", swatch: "#322b26" },
  { value: "#5b6b50", label: "Forest", swatch: "#5b6b50" },
  { value: "#b9794c", label: "Terracotta", swatch: "#b9794c" },
  { value: "#8c6248", label: "Warm brown", swatch: "#8c6248" },
  { value: "#435542", label: "Moss", swatch: "#435542" },
  { value: "#6c839f", label: "Slate", swatch: "#6c839f" },
  { value: "#a63d2f", label: "Red", swatch: "#a63d2f" },
] as const;

export const BACKGROUND_COLORS = [
  { value: "", label: "None", swatch: "transparent" },
  { value: "#fff3d9", label: "Sand", swatch: "#fff3d9" },
  { value: "#e4edd9", label: "Mint", swatch: "#e4edd9" },
  { value: "#e3ecf5", label: "Ice", swatch: "#e3ecf5" },
  { value: "#f9e2d7", label: "Apricot", swatch: "#f9e2d7" },
  { value: "#efe6f7", label: "Lavender", swatch: "#efe6f7" },
] as const;

export const HEADING_OPTIONS = [
  { value: "paragraph", label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
] as const;

export const PLACEHOLDER_TEXT = "Start writing…";

/** Editor zoom steps: 5% increments from 50% to 150%. */
export const ZOOM_OPTIONS: readonly number[] = Array.from(
  { length: 21 },
  (_, index) => 0.5 + index * 0.05,
);

/* ---------- Paged document (shared with export pipeline and create page) ---------- */

export {
  PAGE_FORMATS,
  PAGE_MARGIN_MM,
  uniformMargins,
  marginsEqual,
  PAGE_MARGIN_OPTIONS,
  marginPx,
  PAGE_MARGIN_X,
  PAGE_MARGIN_Y,
  pageSizeMicrons,
} from "../../../shared/document/pageGeometry";
export type {
  PageFormat,
  PageFormatInfo,
  PageMargins,
} from "../../../shared/document/pageGeometry";

