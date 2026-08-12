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

/** Per-side page margins, in millimetres. */
export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function uniformMargins(mm: number): PageMargins {
  return { top: mm, right: mm, bottom: mm, left: mm };
}

export function marginsEqual(a: PageMargins, b: PageMargins): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

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

/** Physical page size in microns, for Electron's `printToPDF` pageSize option. */
export function pageSizeMicrons(format: PageFormat): { width: number; height: number } {
  const { width, height } = PAGE_FORMATS[format];
  return {
    width: Math.round((width / 96) * 25400),
    height: Math.round((height / 96) * 25400),
  };
}