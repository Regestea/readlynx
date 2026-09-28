import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import type { ExportThemeOptions } from "../types";
import { buildHtmlDocument } from "../../../../infrastructure/export/htmlDocument";

/** Lexical adapter over the shared HTML document assembly: the editor only
 *  has to hand over its serialized body, everything else is common. */
export function exportHtml(editor: LexicalEditor, options: ExportThemeOptions = {}, coverImage?: string): string {
  const body = editor.read(() => $generateHtmlFromNodes(editor));
  return buildHtmlDocument(body, options, coverImage);
}
