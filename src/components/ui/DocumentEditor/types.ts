import type { LexicalEditor } from "lexical";

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
  /** CSS font-size ("" = document default). */
  fontSize?: string;
  /** Text color, hex. */
  textColor?: string;
  /** Page / background color, hex. */
  backgroundColor?: string;
  /** Page margin in millimeters. */
  marginMm?: number;
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
