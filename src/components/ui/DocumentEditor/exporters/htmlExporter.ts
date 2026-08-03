import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import type { ExportThemeOptions } from "../types";

export function exportHtml(editor: LexicalEditor, options: ExportThemeOptions = {}): string {
  const body = editor.read(() => $generateHtmlFromNodes(editor));

  const bodyProps = [
    "margin: 0 auto",
    "max-width: 46em",
    "line-height: 1.6",
    `padding: ${options.marginMm ?? 25}mm`,
    ...(options.fontFamily ? [`font-family: ${options.fontFamily}`] : []),
    ...(options.fontSize ? [`font-size: ${options.fontSize}`] : []),
    ...(options.textColor ? [`color: ${options.textColor}`] : []),
    ...(options.backgroundColor ? [`background-color: ${options.backgroundColor}`] : []),
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Document</title>
    <style>
  body { ${bodyProps}; }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}
