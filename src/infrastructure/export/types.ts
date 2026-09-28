import type { PageFormat, PageMargins } from "../../shared/document/pageGeometry";
import type { ExportCodeThemeId, ExportTemplateId } from "./exportTheme";

/** One file of an EPUB container (the unzipped package). */
export interface EpubFile {
  path: string;
  mime: string;
  content: string;
}

/** Descriptive metadata written into the EPUB package document. */
export interface EpubMetadata {
  title?: string;
  author?: string;
  language?: string;
  identifier?: string;
}

/** Options that drive the Paged.js layout for preview and PDF export. */
/** A chapter break is only worth inserting if the page it opens holds enough
 *  to be readable rather than a heading stranded above two lines of text. */
export const DEFAULT_CHAPTER_MIN_LINES = 12;

export interface PdfExportOptions {
  /** Physical page format, e.g. `"a4"`. */
  pageFormat: PageFormat;
  /** Per-side margin, in millimetres. */
  margins: PageMargins;
  /** CSS font-family list ("" = document default). */
  fontFamily?: string;
  /** Global font-size scale in percent (0 = keep the sizes as authored). */
  fontSizeScalePct?: number;
  /** Text colour, hex. */
  textColor?: string;
  /** Page / background colour, hex. */
  backgroundColor?: string;
  /** Document look: none (plain), or a modern light/dark template. */
  template?: ExportTemplateId;
  /** Syntax highlight theme for code blocks (auto follows the document mode). */
  codeTheme?: ExportCodeThemeId;
  /** Monospace font family for code blocks ("" = default). */
  codeFontFamily?: string;
  /** Print a centred page number on every page. */
  showPageNumbers?: boolean;
  /** Heading level (1-5) whose headings start a new page; 0 = no breaks. The
     *  matching class is stamped onto the headings by the pagination pass. */
  chapterLevels?: readonly number[];
  /** Drop a chapter break whose page would hold fewer than this many lines of
   *  text; 0 keeps every break. Measured on the rendered page, so it follows
   *  the page size and the font scale. */
  chapterMinLines?: number;
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
  textColor: "",
  backgroundColor: "",
  showPageNumbers: true,
  chapterLevels: [1],
  chapterMinLines: DEFAULT_CHAPTER_MIN_LINES,
  inlineImages: true,
  };

/** A finished, ready-to-print paginated document. */
export interface PagedDocument {
  /** Number of `.pagedjs_page` elements produced by Paged.js. */
  pageCount: number;
  /** Chapter breaks the empty-page pass removed, so a caller can report or
   *  assert on what the layout pass decided. */
  chapterBreaksDropped: number;
  /** The `.pagedjs_page` elements produced by Paged.js. */
  pages: HTMLElement[];
  /** Full standalone HTML document (fonts + CSS + paginated pages). */
  html: string;
  /** Release layout hosts / previewer resources. */
  destroy: () => void;
}

/** Convenience identity used by the preview host to avoid interfering with
 *  whatever produced the body HTML. */
export type PageRenderer = (bodyHtml: string) => Promise<PagedDocument>;