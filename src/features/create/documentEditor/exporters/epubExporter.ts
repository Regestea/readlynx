import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import type { ExportThemeOptions } from "../types";
import type { EpubFile, EpubMetadata } from "../../../../infrastructure/export/types";
import { buildEpubFiles } from "../../../../infrastructure/export/epubWriter";

/** Lexical adapter over the shared EPUB writer: the editor only hands over
 *  its serialized body, the package assembly itself is common to every
 *  export source. */
export function exportEpub(
  editor: LexicalEditor,
  metadata: EpubMetadata = {},
  options: ExportThemeOptions = {},
  coverImage?: string,
): EpubFile[] {
  const bodyHtml = editor.read(() => $generateHtmlFromNodes(editor));
  return buildEpubFiles(bodyHtml, metadata, options, coverImage);
}
