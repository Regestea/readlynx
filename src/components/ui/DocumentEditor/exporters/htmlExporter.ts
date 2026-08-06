import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import type { ExportThemeOptions } from "../types";

export function exportHtml(editor: LexicalEditor, options: ExportThemeOptions = {}, coverImage?: string): string {
  const body = editor.read(() => $generateHtmlFromNodes(editor));

  const marginMm = options.marginMm ?? 25;
  const coverDiv = coverImage
    ? `<div style="display:flex;align-items:center;justify-content:center;overflow:hidden;width:100vw;height:100vh;margin:-${marginMm}mm;page-break-after:always;"><img src="${coverImage}" style="width:100%;height:100%;object-fit:cover;" /></div>`
    : "";

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
    ${coverDiv}${body}
  </body>
</html>`;
}
