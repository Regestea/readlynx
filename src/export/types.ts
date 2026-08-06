import type { LexicalEditor } from "lexical";
import type { PageFormat, PageMargins } from "../components/ui/DocumentEditor/constants";

/** Options that drive the Paged.js layout for preview and PDF export. */
export interface PdfExportOptions {
  /** Physical page format, e.g. `"a4"`. */
  pageFormat: PageFormat;
  /** Per-side margin, in millimetres. */
  margins: PageMargins;
  /** CSS font-family list ("" = document default). */
  fontFamily?: string;
  /** CSS font-size ("" = document default). */
  fontSize?: string;
  /** Text colour, hex. */
  textColor?: string;
  /** Page / background colour, hex. */
  backgroundColor?: string;
  /** Print a centred page number on every page. */
  showPageNumbers?: boolean;
  /** Start every `h1` on a new page. */
  chapterBreaks?: boolean;
  /** Keep line-height at the value the author set in the editor when non-empty. */
  lineHeight?: string;
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
  /** Resolve blob/data-dependency image URLs into data URLs before export. */
  inlineImages?: boolean;
  /** Cover image data URL or path — rendered as the first page. */
  coverImage?: string;
}

export const DEFAULT_PDF_EXPORT_OPTIONS: Omit<PdfExportOptions, "pageFormat" | "margins"> = {
  fontFamily: "",
  fontSize: "",
  textColor: "",
  backgroundColor: "",
  showPageNumbers: true,
  chapterBreaks: true,
  inlineImages: true,
};

/** A finished, ready-to-print paginated document. */
export interface PagedDocument {
  /** Number of laid-out pages. */
  pageCount: number;
  /** The `.pagedjs_page` elements produced by Paged.js. */
  pages: HTMLElement[];
  /** Full standalone HTML document (fonts + CSS + paginated pages). */
  html: string;
  /** Release layout hosts / previewer resources. */
  destroy: () => void;
}

/** Convenience identity used by the preview host to avoid interfering with the editor. */
export type PageRenderer = (editor: LexicalEditor) => Promise<PagedDocument>;