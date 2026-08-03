export const FONT_SIZE_OPTIONS = [
  { value: "", label: "Default" },
  { value: "12px", label: "12px" },
  { value: "14px", label: "14px" },
  { value: "16px", label: "16px" },
  { value: "18px", label: "18px" },
  { value: "20px", label: "20px" },
  { value: "24px", label: "24px" },
  { value: "28px", label: "28px" },
  { value: "32px", label: "32px" },
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

/* ---------- Paged document ---------- */

export type PageFormat =
  | "a4"
  | "a5"
  | "a3"
  | "b5"
  | "letter"
  | "legal"
  | "tabloid"
  | "executive";

export interface PageFormatInfo {
  label: string;
  width: number;
  height: number;
  /** CSS `@page { size: ... }` value (length pair) for exact print/PDF output. */
  cssSize: string;
}

export const PAGE_FORMATS: Record<PageFormat, PageFormatInfo> = {
  a4: { label: "A4", width: 794, height: 1123, cssSize: "210mm 297mm" },
  a5: { label: "A5", width: 559, height: 794, cssSize: "148mm 210mm" },
  a3: { label: "A3", width: 1123, height: 1587, cssSize: "297mm 420mm" },
  b5: { label: "B5", width: 665, height: 945, cssSize: "176mm 250mm" },
  letter: { label: "Letter", width: 816, height: 1056, cssSize: "8.5in 11in" },
  legal: { label: "Legal", width: 816, height: 1344, cssSize: "8.5in 14in" },
  tabloid: { label: "Tabloid", width: 1056, height: 1632, cssSize: "11in 17in" },
  executive: { label: "Executive", width: 696, height: 1008, cssSize: "7.25in 10.5in" },
};

/** Standard page margin (0.5 inch = 12.7 mm) applied on all four sides. */
export const PAGE_MARGIN_MM = 12.7;

export const PAGE_MARGIN_OPTIONS = [
  { value: 8, label: "Narrow" },
  { value: 12.7, label: "Normal" },
  { value: 20, label: "Wide" },
] as const;

/** On-screen margin in px at 96 dpi (1 inch = 96 px), so the margins match
 *  the physical `@page` margins used when printing / exporting to PDF exactly. */
export function marginPx(marginMm: number): number {
  return Math.round((marginMm / 25.4) * 96);
}

export const PAGE_MARGIN_X = marginPx(PAGE_MARGIN_MM);
export const PAGE_MARGIN_Y = marginPx(PAGE_MARGIN_MM);

export const ZOOM_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const;

/** Physical page size in microns, for Electron's `printToPDF` pageSize option. */
export function pageSizeMicrons(format: PageFormat): { width: number; height: number } {
  const { width, height } = PAGE_FORMATS[format];
  return {
    width: Math.round((width / 96) * 25400),
    height: Math.round((height / 96) * 25400),
  };
}

