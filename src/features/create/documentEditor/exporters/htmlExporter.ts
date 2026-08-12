import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import type { ExportThemeOptions } from "../types";
import { uniformMargins } from "../constants";
import { scaleHtmlFontSizes, scaledBaseFontSize } from "../../../../infrastructure/export/fontScale";
import { katexCssForExport } from "../../../../infrastructure/export/katexExportCss";

export function exportHtml(editor: LexicalEditor, options: ExportThemeOptions = {}, coverImage?: string): string {
  const body = scaleHtmlFontSizes(
    editor.read(() => $generateHtmlFromNodes(editor)),
    options.fontSizeScalePct,
  );
  const m = options.margins ?? uniformMargins(25);
  const baseFontSize = scaledBaseFontSize(options.fontSizeScalePct, 16);

  const coverDiv = coverImage
    ? `<div style="display:flex;align-items:center;justify-content:center;overflow:hidden;width:100vw;height:100vh;margin:-${m.top}mm -${m.right}mm -${m.bottom}mm -${m.left}mm;page-break-after:always;"><img src="${coverImage}" style="width:100%;height:100%;object-fit:cover;" /></div>`
    : "";

  const bodyProps = [
    "margin: 0 auto",
    "max-width: 46em",
    "line-height: 1.6",
    `padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`,
    ...(options.fontFamily ? [`font-family: ${options.fontFamily}`] : []),
    ...(baseFontSize ? [`font-size: ${baseFontSize}`] : []),
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
    <style>
  ${katexCssForExport()}
    </style>
  </head>
  <body>
    ${coverDiv}${body}
  </body>
</html>`;
}
