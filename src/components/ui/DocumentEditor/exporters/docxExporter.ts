import type { ElementNode, LexicalEditor, LexicalNode, TextNode } from "lexical";
import { $getRoot, $isElementNode, $isTextNode } from "lexical";
import { $isLinkNode } from "@lexical/link";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $isCodeNode } from "@lexical/code";
import { $isHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $isTableCellNode, $isTableNode, $isTableRowNode } from "@lexical/table";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PAGE_FORMATS } from "../constants";
import type { PageFormat } from "../constants";
import type { ExportThemeOptions } from "../types";
import { isRtlDominant } from "../utils/direction";
import { $isCalloutNode } from "../nodes/CalloutNode";
import { $isCustomBlockNode } from "../nodes/CustomBlockNode";
import { $isImageNode } from "../nodes/ImageNode";
import type { ImageNode } from "../nodes/ImageNode";
import { $isPageBreakNode } from "../nodes/PageBreakNode";

type DocxChild = Paragraph | Table;

/** Lexical TextFormatType bit flags. */
const IS_BOLD = 1;
const IS_ITALIC = 2;
const IS_STRIKETHROUGH = 4;
const IS_UNDERLINE = 8;
const IS_CODE = 16;
const IS_SUBSCRIPT = 32;
const IS_SUPERSCRIPT = 64;
const IS_HIGHLIGHT = 128;

const MONO_FONT = "Consolas";
const MAX_LIST_DEPTH = 4;
const DEFAULT_MARGIN_MM = 12.7;

const BLOCK_SHADING: Record<string, string> = {
  info: "EAF2FB",
  success: "E9F5EA",
  warning: "FDF3DD",
  error: "FBE9E9",
  aside: "F5F5F4",
  spoiler: "F5F0E6",
  insight: "EDF3EC",
};

function twipsFromPx(px: number): number {
  return Math.round((px / 96) * 1440);
}

type ImageType = "png" | "jpg" | "gif";

/** Reads the intrinsic width/height of a PNG, JPEG, or GIF from its bytes. */
function imageAspectRatio(type: ImageType, data: Uint8Array): { width: number; height: number } | null {
  if (type === "png") {
    if (data.length < 24) return null;
    const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
    const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (type === "gif") {
    if (data.length < 10) return null;
    const width = data[6] | (data[7] << 8);
    const height = data[8] | (data[9] << 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    const length = (data[i + 2] << 8) | data[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && length >= 7 && i + 8 < data.length) {
      const height = (data[i + 5] << 8) | data[i + 6];
      const width = (data[i + 7] << 8) | data[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    i += 2 + length;
  }
  return null;
}

function parseColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return h.toUpperCase();
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(trimmed);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return undefined;
}

/** Converts a CSS font-size (px/pt/rem/em) to Word half-points. */
function fontSizeHalfPoints(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^([\d.]+)\s*(px|pt|rem|em)?$/.exec(value.trim());
  if (!match) return undefined;
  const size = Number(match[1]);
  const unit = match[2] ?? "px";
  const points =
    unit === "px" ? size * 0.75 : unit === "pt" ? size : (unit === "rem" || unit === "em" ? size * 12 : size);
  return Math.round(points * 2);
}

interface InlineStyle {
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  backgroundColor?: string;
}

function parseInlineStyle(style: string): InlineStyle {
  const out: InlineStyle = {};
  for (const declaration of style.split(";")) {
    const [prop, ...rest] = declaration.split(":");
    const value = rest.join(":").trim();
    if (!value) continue;
    switch (prop.trim().toLowerCase()) {
      case "font-family":
        out.fontFamily = value;
        break;
      case "font-size":
        out.fontSize = value;
        break;
      case "color":
        out.color = value;
        break;
      case "background-color":
        out.backgroundColor = value;
        break;
      default:
        break;
    }
  }
  return out;
}

function runFromTextNode(node: TextNode): TextRun {
  const format = node.getFormat();
  const style = parseInlineStyle(node.getStyle());
  const isCode = Boolean(format & IS_CODE);
  const fontFamily = style.fontFamily?.split(",")[0]?.trim();
  const generic = ["sans-serif", "serif", "monospace", "cursive", "fantasy"];
  return new TextRun({
    text: node.getTextContent(),
    bold: Boolean(format & IS_BOLD),
    italics: Boolean(format & IS_ITALIC),
    underline: format & IS_UNDERLINE ? {} : undefined,
    strike: Boolean(format & IS_STRIKETHROUGH),
    superScript: Boolean(format & IS_SUPERSCRIPT),
    subScript: Boolean(format & IS_SUBSCRIPT),
    highlight: format & IS_HIGHLIGHT ? "yellow" : undefined,
    font: isCode ? MONO_FONT : fontFamily && !generic.includes(fontFamily) ? fontFamily : undefined,
    size: fontSizeHalfPoints(style.fontSize),
    color: parseColor(style.color),
    shading: style.backgroundColor
      ? {
          type: ShadingType.CLEAR,
          fill: parseColor(style.backgroundColor),
          color: "auto",
        }
      : undefined,
  });
}

function buildRuns(node: LexicalNode): (TextRun | ExternalHyperlink)[] {
  if ($isTextNode(node)) return [runFromTextNode(node)];
  if ($isLinkNode(node)) {
    return [
      new ExternalHyperlink({
        link: node.getURL(),
        children: node.getChildren().flatMap((child) => buildRuns(child)) as TextRun[],
      }),
    ];
  }
  if ($isElementNode(node)) return node.getChildren().flatMap((child) => buildRuns(child));
  return [];
}

type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];
type DocxHeadingLevel = (typeof HeadingLevel)[keyof typeof HeadingLevel];

/**
 * True when a block should render RTL: explicit `rtl` direction, or (for
 * documents saved before directions were recorded) dominant RTL content.
 */
function isRtlBlock(node: ElementNode): boolean {
  const dir = node.getDirection();
  return dir === "rtl" || (dir === null && isRtlDominant(node.getTextContent()));
}

function alignmentFromNode(node: ElementNode): DocxAlignment | undefined {
  switch (node.getFormat()) {
    case 1:
      return AlignmentType.LEFT;
    case 2:
      return AlignmentType.CENTER;
    case 3:
      return AlignmentType.RIGHT;
    case 4:
      return AlignmentType.JUSTIFIED;
    default:
      return isRtlBlock(node) ? AlignmentType.RIGHT : undefined;
  }
}

function codeParagraphs(node: LexicalNode): Paragraph[] {
  return node
    .getTextContent()
    .split("\n")
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line || " ", font: MONO_FONT, size: 20 })],
          shading: { type: ShadingType.CLEAR, fill: "F5F5F4", color: "auto" },
          spacing: { after: 0 },
        }),
    );
}

function listParagraphs(node: LexicalNode, depth: number): DocxChild[] {
  if (!$isListNode(node)) return [];
  const isCheck = node.getListType() === "check";
  const isNumbered = node.getListType() === "number";
  const reference = isNumbered ? "readlynx-ordered" : "readlynx-unordered";
  const out: DocxChild[] = [];
  for (const item of node.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const runs: (TextRun | ExternalHyperlink)[] = [];
    if (isCheck) {
      runs.push(new TextRun({ text: item.getChecked() ? "\u2611 " : "\u2610 " }));
    }
    for (const child of item.getChildren()) {
      if ($isListNode(child)) continue;
      runs.push(...buildRuns(child));
    }
    out.push(
      new Paragraph({
        children: runs,
        numbering: isCheck ? undefined : { reference, level: Math.min(depth, MAX_LIST_DEPTH) },
        bidirectional: isRtlBlock(item),
      }),
    );
    for (const child of item.getChildren()) {
      if ($isListNode(child)) out.push(...listParagraphs(child, depth + 1));
    }
  }
  return out;
}

function tableChildren(node: ElementNode): Table {
  const rows = node
    .getChildren()
    .filter($isTableRowNode)
    .map(
      (row) =>
        new TableRow({
          children: row
            .getChildren()
            .filter($isTableCellNode)
            .map(
              (cell) =>
                new TableCell({
                  children: cell.getChildren().flatMap((child) => nodeToDocx(child)) as Paragraph[],
                }),
            ),
        }),
    );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function imageParagraph(node: ImageNode): Paragraph[] {
  const src = node.getSrc();
  const match = /^data:image\/(png|jpe?g|gif);base64,(.+)$/.exec(src);
  if (!match) return [];
  const type = match[1] === "jpeg" || match[1] === "jpg" ? "jpg" : (match[1] as "png" | "gif");
  const binary = atob(match[2]);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
  const image = new ImageRun({
    type,
    data,
    transformation: { width: 240, height: Math.round(240 * 0.75) },
  });
  return [new Paragraph({ children: [image] })];
}

function nodeToDocx(node: LexicalNode): DocxChild[] {
  if ($isHeadingNode(node)) {
    const level = node.getTag() as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const heading: Record<string, DocxHeadingLevel> = {
      h1: HeadingLevel.HEADING_1,
      h2: HeadingLevel.HEADING_2,
      h3: HeadingLevel.HEADING_3,
      h4: HeadingLevel.HEADING_4,
      h5: HeadingLevel.HEADING_5,
      h6: HeadingLevel.HEADING_6,
    };
    return [
      new Paragraph({
        heading: heading[level],
        children: buildRuns(node),
        alignment: alignmentFromNode(node),
        bidirectional: isRtlBlock(node),
      }),
    ];
  }
  if ($isQuoteNode(node)) {
    return [
      new Paragraph({
        children: buildRuns(node),
        indent: { left: 720 },
        alignment: alignmentFromNode(node),
        bidirectional: isRtlBlock(node),
      }),
    ];
  }
  if ($isCodeNode(node)) return codeParagraphs(node);
  if ($isListNode(node)) return listParagraphs(node, 0);
  if ($isHorizontalRuleNode(node)) {
    return [
      new Paragraph({
        children: [],
        border: {
          bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 },
        },
      }),
    ];
  }
  if ($isPageBreakNode(node)) {
    return [new Paragraph({ children: [new PageBreak()] })];
  }
  if ($isImageNode(node)) return imageParagraph(node);
  if ($isTableNode(node)) return [tableChildren(node)];
  if ($isCalloutNode(node) || $isCustomBlockNode(node)) {
    const tone = $isCalloutNode(node) ? node.getTone() : node.getKind();
    return [
      new Paragraph({
        children: buildRuns(node),
        shading: {
          type: ShadingType.CLEAR,
          fill: BLOCK_SHADING[tone] ?? "F5F5F4",
          color: "auto",
        },
        indent: { left: 240, right: 240 },
        alignment: alignmentFromNode(node),
        bidirectional: isRtlBlock(node),
      }),
    ];
  }
  if ($isElementNode(node)) {
    return [
      new Paragraph({
        children: buildRuns(node),
        alignment: alignmentFromNode(node),
        bidirectional: isRtlBlock(node),
      }),
    ];
  }
  return [];
}

const NUMBERING_CONFIG = [
  {
    reference: "readlynx-unordered",
    levels: Array.from({ length: MAX_LIST_DEPTH + 1 }, (_, level) => ({
      level,
      format: LevelFormat.BULLET,
      text: "\u2022",
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 720 + level * 360, hanging: 360 } },
      },
    })),
  },
  {
    reference: "readlynx-ordered",
    levels: Array.from({ length: MAX_LIST_DEPTH + 1 }, (_, level) => ({
      level,
      format: LevelFormat.DECIMAL,
      text: "%1.",
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 720 + level * 360, hanging: 360 } },
      },
    })),
  },
] as const;

const GENERIC_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy"]);

/** First family name from a CSS font-family list, or the fallback. */
function concreteFont(value: string | undefined, fallback: string): string {
  const first = value
    ?.split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return first && !GENERIC_FAMILIES.has(first.toLowerCase()) ? first : fallback;
}

export async function exportDocx(
  editor: LexicalEditor,
  format: PageFormat,
  options: ExportThemeOptions = {},
  coverImage?: string,
): Promise<Blob> {
  const contentChildren = editor.getEditorState().read(() => {
    const root = $getRoot();
    return root.getChildren().flatMap((node) => nodeToDocx(node));
  });

  const { width, height } = PAGE_FORMATS[format];
  const marginMm = options.marginMm ?? DEFAULT_MARGIN_MM;
  const margin = Math.round((marginMm / 25.4) * 1440);

  const coverChildren: DocxChild[] = [];
  if (coverImage) {
    const match = /^data:image\/(png|jpe?g|gif);base64,(.+)$/.exec(coverImage);
    if (match) {
      const type = match[1] === "jpeg" || match[1] === "jpg" ? "jpg" : (match[1] as ImageType);
      const binary = atob(match[2]);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
      const pageWidthPt = twipsFromPx(width) / 20;
      const pageHeightPt = twipsFromPx(height) / 20;
      const aspect = imageAspectRatio(type, data);
      let imgWidthPt = pageWidthPt;
      let imgHeightPt = pageHeightPt;
      if (aspect) {
        const scale = Math.min(pageWidthPt / aspect.width, pageHeightPt / aspect.height);
        imgWidthPt = aspect.width * scale;
        imgHeightPt = aspect.height * scale;
      }
      coverChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type,
              data,
              transformation: {
                width: Math.round(imgWidthPt),
                height: Math.round(imgHeightPt),
              },
            }),
          ],
          spacing: { after: 0 },
        }),
      );
    }
  }

  const defaultRun: {
    font: string;
    size?: number;
    color?: string;
  } = { font: concreteFont(options.fontFamily, "Calibri") };
  if (options.fontSize) {
    const size = fontSizeHalfPoints(options.fontSize);
    if (size !== undefined) defaultRun.size = size;
  }
  if (options.textColor) {
    const color = parseColor(options.textColor);
    if (color) defaultRun.color = color;
  }

  const pageSize = { width: twipsFromPx(width), height: twipsFromPx(height) };
  const document = new Document({
    numbering: { config: NUMBERING_CONFIG },
    ...(options.backgroundColor
      ? { background: { color: parseColor(options.backgroundColor) ?? "FFFFFF" } }
      : {}),
    styles: {
      default: {
        document: {
          run: defaultRun,
          paragraph: {
            spacing: { line: 360, lineRule: LineRuleType.AUTO },
          },
        },
      },
    },
    sections: [
      ...(coverChildren.length > 0
        ? [
            {
              properties: {
                page: {
                  size: pageSize,
                  margin: { top: 0, right: 0, bottom: 0, left: 0 },
                },
              },
              children: coverChildren,
            },
          ]
        : []),
      {
        properties: {
          page: {
            size: pageSize,
            margin: { top: margin, right: margin, bottom: margin, left: margin },
          },
        },
        children: contentChildren,
      },
    ],
  });

  return Packer.toBlob(document);
}
