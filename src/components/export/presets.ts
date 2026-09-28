import { PAGE_FORMATS } from "../../shared/document/pageGeometry";
import type { PageFormat } from "../../shared/document/pageGeometry";
import { TEXT_COLORS } from "../../shared/document/textColors";
import { EXPORT_TEMPLATES } from "../../infrastructure/export/exportTheme";
import type { ExportTemplateId } from "../../infrastructure/export/exportTheme";
import type { ExportSettings } from "./types.tsx";

/**
 * Option lists for the export dialog. Kept apart from the component so the
 * dialog stays a view over whatever the host's `ExportContent` declares, and
 * so a source-specific list can be swapped in without touching the JSX.
 */

export interface TemplateChip {
  id: ExportTemplateId;
  name: string;
  desc: string;
  textColor: string;
  backgroundColor: string;
  /** Uniform page margin in millimeters applied to every side. */
  marginMm: number;
}

/** "None" keeps the plain look: no colours forced, default margins. */
export const TEMPLATE_CHIPS: TemplateChip[] = [
  {
    id: "none",
    name: "None",
    desc: "Plain look",
    textColor: "",
    backgroundColor: "",
    marginMm: 0,
  },
  ...EXPORT_TEMPLATES.map(({ id, name, desc, textColor, backgroundColor, marginMm }) => ({
    id,
    name,
    desc,
    textColor,
    backgroundColor,
    marginMm,
  })),
];

export const PAPER_COLORS = [
  { value: "#ffffff", label: "White", swatch: "#ffffff" },
  { value: "#faf6ef", label: "Cream", swatch: "#faf6ef" },
  { value: "#f4f4f0", label: "Stone", swatch: "#f4f4f0" },
  { value: "#eef3f9", label: "Ice", swatch: "#eef3f9" },
  { value: "#fdf6e3", label: "Sand", swatch: "#fdf6e3" },
  { value: "#e9f1ec", label: "Mint", swatch: "#e9f1ec" },
];

export const PAGE_FORMAT_OPTIONS: { value: PageFormat; label: string }[] = (
  Object.keys(PAGE_FORMATS) as PageFormat[]
).map((key) => ({ value: key, label: PAGE_FORMATS[key].label }));

export const MARGIN_SIDES: {
  key: "marginTopMm" | "marginRightMm" | "marginBottomMm" | "marginLeftMm";
  label: string;
}[] = [
  { key: "marginTopMm", label: "Top" },
  { key: "marginRightMm", label: "Right" },
  { key: "marginBottomMm", label: "Bottom" },
  { key: "marginLeftMm", label: "Left" },
];

/** How full a page must be for a chapter break to be worth inserting, in lines
 *  of body text. 0 keeps every break. */
export const CHAPTER_MIN_LINES_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Keep every break" },
  { value: 4, label: "Only if the page holds 4+ lines" },
  { value: 8, label: "Only if the page holds 8+ lines" },
  { value: 12, label: "Only if the page holds 12+ lines" },
  { value: 20, label: "Only if the page holds 20+ lines" },
];

/** Heading levels that can start a new page, as tickable options. An empty
 *  selection means the document flows without chapter breaks. */
export const CHAPTER_LEVEL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Each H1 (top-level heading)" },
  { value: 2, label: "Each H2" },
  { value: 3, label: "Each H3" },
  { value: 4, label: "Each H4" },
  { value: 5, label: "Each H5" },
];

export { TEXT_COLORS };

/** True when the chosen colour is not one of the presets (so the custom
 *  swatch shows as active). */
export function isCustomColor(value: string, presets: readonly { value: string }[]): boolean {
  return value !== "" && !presets.some((preset) => preset.value.toLowerCase() === value.toLowerCase());
}

/** `<input type="color">` needs a real hex; empty means "no override". */
export function safeHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

/** Default settings, with the host's page geometry applied. */
export function initialExportSettings(
  defaults: ExportSettings,
  options: { defaultMarginMm?: number; defaultPageFormat?: PageFormat } = {},
): ExportSettings {
  const margin = options.defaultMarginMm;
  return {
    ...defaults,
    ...(margin === undefined
      ? {}
      : {
          marginTopMm: margin,
          marginRightMm: margin,
          marginBottomMm: margin,
          marginLeftMm: margin,
        }),
    pageFormat: options.defaultPageFormat ?? defaults.pageFormat,
  };
}
