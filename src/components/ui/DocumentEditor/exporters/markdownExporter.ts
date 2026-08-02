import type { LexicalEditor } from "lexical";
import { $convertToMarkdownString } from "@lexical/markdown";
import { mdTransformers } from "../plugins/MarkdownPlugin";

export function exportMarkdown(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $convertToMarkdownString(mdTransformers));
}
