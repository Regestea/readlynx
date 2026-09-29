import type { ReactNode } from "react";
import { FileDown, FileOutput, FileText, FileType2 } from "lucide-react";
import type { PageFormat } from "../../shared/document/pageGeometry";
import type { ExportThemeOptions } from "../../infrastructure/export/exportTheme";
import { DEFAULT_CHAPTER_MIN_LINES } from "../../infrastructure/export/types";

/** Output format of an export. */
export type ExportFormat = "pdf" | "docx" | "html" | "epub";

/** Everything the export dialog lets the user configure, per format. */
export interface ExportSettings {
  format: ExportFormat;
  /** Global font-size scale in percent (0 = as authored, negative = smaller). */
  fontSizeScalePct: number;
  /** CSS font-family list ("" = document default). */
  fontFamily: string;
  textColor: string;
  backgroundColor: string;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  /** PDF/DOCX-only: physical page size. */
  pageFormat: PageFormat;
  /** PDF/DOCX-only: run a centred page number in the footer. */
  showPageNumbers: boolean;
  /** PDF/DOCX-only: heading levels (1-5) whose headings start a new page;
   *  empty = no breaks. */
  chapterLevels: number[];
  /** PDF-only: drop a break whose page would hold fewer lines than this;
   *  0 keeps every break. Measured on the rendered page, so it needs the
   *  paginator a Word file does not have. */
  chapterMinLines: number;
  /** PDF/EPUB/DOCX-only: document look (none / modern light / modern dark). */
  template: "none" | "light" | "dark";
  /** PDF/EPUB/DOCX-only: code block highlight theme. */
  codeTheme: "auto" | "light" | "dark" | "monokai" | "night-owl" | "vs" | "nord";
  /** PDF/EPUB/DOCX-only: monospace font for code blocks ("" = default). */
  codeFontFamily: string;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: "pdf",
  fontSizeScalePct: 0,
  fontFamily: "",
  textColor: "",
  backgroundColor: "",
  marginTopMm: 12.7,
  marginRightMm: 12.7,
  marginBottomMm: 12.7,
  marginLeftMm: 12.7,
  pageFormat: "a4",
  showPageNumbers: true,
  chapterLevels: [1],
  chapterMinLines: DEFAULT_CHAPTER_MIN_LINES,
  template: "none",
  codeTheme: "auto",
  codeFontFamily: "",
};

/**
 * A document the export dialog can preview and the host can write out.
 *
 * The dialog is deliberately source-agnostic: it never knows whether the
 * content comes from the Lexical editor, a translated book, or something
 * else. It only needs the semantic HTML body (for pagination and the
 * HTML/DOCX preview) and, for the EPUB preview, the finished archive. The
 * host owns the actual writing of the file, which is why the dialog reports
 * back the chosen `ExportSettings` instead of doing the export itself.
 */
export interface ExportContent {
  /** Noun for the source ("Document", "Translated book"), used in the
   *  dialog title and the export button labels. */
  label: string;
  /** Formats this source can really produce. The dialog only offers these,
   *  so a host never shows a tab it cannot honour. */
  formats: readonly ExportFormat[];
  /** Semantic HTML body fragment (no `<html>`/`<head>`). Paged.js turns it
   *  into physical pages, and the HTML/DOCX path wraps it in a document.
   *
   *  Chapter breaks are *not* the source's business: they need the paginator,
   *  so the PDF pipeline stamps and measures them itself. That keeps the
   *  preview and the exported file on one code path. */
  bodyHtml(): string;
  /** Zipped EPUB archive bytes for the EPUB preview. Omit when the source
   *  cannot produce an EPUB (the EPUB tab is then not offered). Async
   *  because zipping is. Receives the live theme so the preview reflects the
   *  options currently picked. */
  epub?(theme: ExportThemeOptions, coverImage?: string): Promise<ArrayBuffer | null> | ArrayBuffer | null;
}

/** One entry of the format tab strip. */
export interface ExportFormatOption {
  value: ExportFormat;
  label: string;
  icon: ReactNode;
}

export const EXPORT_FORMAT_OPTIONS: ExportFormatOption[] = [
  { value: "pdf", label: "PDF", icon: <FileDown size={14} strokeWidth={1.8} aria-hidden="true" /> },
  {
    value: "docx",
    label: "DOCX",
    icon: <FileOutput size={14} strokeWidth={1.8} aria-hidden="true" />,
  },
  { value: "html", label: "HTML", icon: <FileText size={14} strokeWidth={1.8} aria-hidden="true" /> },
  {
    value: "epub",
    label: "EPUB",
    icon: <FileType2 size={14} strokeWidth={1.8} aria-hidden="true" />,
  },
];

/** Formats whose look the writer can reproduce: the template palette and the
 *  code-block theme. HTML is a plain dump, so it offers neither. */
export function usesThemedLook(format: ExportFormat): boolean {
  return format === "pdf" || format === "epub" || format === "docx";
}

/** Formats laid out on real pages, so their page size, page numbers and
 *  chapter breaks can be set. HTML is one continuous scroll, EPUB paginates on
 *  the reader's screen. */
export function usesPageLayout(format: ExportFormat): boolean {
  return format === "pdf" || format === "docx";
}
