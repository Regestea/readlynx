import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";

export function exportHtml(editor: LexicalEditor): string {
  return editor.read(() => $generateHtmlFromNodes(editor));
}
