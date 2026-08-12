import type { LexicalEditor } from "lexical";
import type { PageMargins } from "./constants";
import type { ExportCodeThemeId, ExportTemplateId } from "../../../infrastructure/export/exportTheme";

/** Result of an EPUB export: the container files of an EPUB 3 book (unzipped). */
export interface EpubFile {
  path: string;
  mime: string;
  content: string;
}

/** Public API exposed to host apps (via `apiRef` or the editor context). */
export interface EditorAPI {
  saveState(): string;
  loadState(json: string): void;
  newDocument(): void;
  importMarkdown(markdown: string): void;
  /** Appends parsed markdown at the end of the document (used by OCR import). */
  appendMarkdown(markdown: string): void;
  exportMarkdown(): string;
  exportHtml(): string;
  exportDocx(): Promise<Blob>;
  exportEpub(metadata?: EpubMetadata): EpubFile[];
  undo(): void;
  redo(): void;
  focus(): void;
  getEditor(): LexicalEditor | null;
}

export interface EpubMetadata {
  title?: string;
  author?: string;
  language?: string;
  identifier?: string;
}

export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "quote"
  | "code"
  | "ul"
  | "ol"
  | "check"
  | "callout"
  | "custom"
  | "table"
  | "hr"
  | "image";

/** Visual options applied when exporting the document (PDF/DOCX/HTML/EPUB). */
export interface ExportThemeOptions {
  /** CSS font-family list ("" = document default). */
  fontFamily?: string;
  /** Global font-size scale in percent (0 = keep the sizes as authored). */
  fontSizeScalePct?: number;
  /** Text color, hex. */
  textColor?: string;
  /** Page / background color, hex. */
  backgroundColor?: string;
  /** Per-side page margins in millimeters. */
  margins?: PageMargins;
  /** Document look: none (plain), or a modern light/dark template. */
  template?: ExportTemplateId;
  /** Syntax highlight theme for code blocks (auto follows the document mode). */
  codeTheme?: ExportCodeThemeId;
  /** Monospace font family for code blocks ("" = default). */
  codeFontFamily?: string;
}

export interface ToolbarState {
  blockType: BlockType;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  highlight: boolean;
  superscript: boolean;
  subscript: boolean;
  code: boolean;
  fontFamily: string;
  fontSize: string;
  textColor: string;
  bgColor: string;
  alignment: "left" | "center" | "right" | "justify";
  isLink: boolean;
  isTable: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const EMPTY_TOOLBAR_STATE: ToolbarState = {
  blockType: "paragraph",
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  highlight: false,
  superscript: false,
  subscript: false,
  code: false,
  fontFamily: "",
  fontSize: "",
  textColor: "",
  bgColor: "",
  alignment: "left",
  isLink: false,
  isTable: false,
  canUndo: false,
  canRedo: false,
};

export type CalloutTone = "info" | "success" | "warning" | "error";
export type CustomBlockKind = "aside" | "spoiler" | "insight";
