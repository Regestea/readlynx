import type { LexicalEditor } from "lexical";
import type { EpubFile, EpubMetadata } from "../../../infrastructure/export/types";

/** EPUB package types and the visual export options now live with the shared
 *  writers that consume them, so the reading view's translated books can build
 *  the same files. Re-exported here because the editor's exporters import
 *  them from this module. */
export type { EpubFile, EpubMetadata } from "../../../infrastructure/export/types";
export type { ExportThemeOptions } from "../../../infrastructure/export/exportTheme";

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
