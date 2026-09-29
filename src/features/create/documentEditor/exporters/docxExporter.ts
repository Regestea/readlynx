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
  Footer,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ImageRun, XmlComponent } from "docx";
import { PAGE_FORMATS, uniformMargins } from "../constants";
import type { PageFormat } from "../constants";
import { fontScaleFactor } from "../../../../infrastructure/export/fontScale";
import { justificationFor, parseWordColor, resolveDocxPalette } from "../../../../infrastructure/export/docxTheme";
import type { DocxExportOptions } from "../../../../infrastructure/export/docxWriter";
import {
  decodeImage,
  fitImage,
  imageRun,
  pngFromWebp,
} from "../../../../infrastructure/export/docxImage";
import type { DecodedImage } from "../../../../infrastructure/export/docxImage";
import { latexToOmml } from "../../../../infrastructure/export/docxMath";
import { resolveBlockDir } from "../../../../shared/document/direction";
import type { TextDir } from "../../../../shared/document/direction";
import { $isCalloutNode } from "../nodes/CalloutNode";
import { $isCustomBlockNode } from "../nodes/CustomBlockNode";
import { $isEquationNode } from "../nodes/EquationNode";
import { $isHtmlBlockNode } from "../nodes/HtmlBlockNode";
import { $isImageNode } from "../nodes/ImageNode";
import type { ImageNode } from "../nodes/ImageNode";
import { $isPageBreakNode } from "../nodes/PageBreakNode";

/**
 * Word writer for the document editor's own node tree.
 *
 * The generic writer in `infrastructure/export/docxWriter.ts` covers the
 * sources that only have HTML; this one walks Lexical directly, so it can keep
 * what only the tree knows — the direction recorded on a block, an equation's
 * inline/display distinction, the tone of a callout. Everything a Word file
 * needs that is not in the tree (the math zone, the picture bytes, the code
 * theme) comes from the shared modules, so the two writers cannot drift apart.
 */

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

const MAX_LIST_DEPTH = 4;
const DEFAULT_MARGIN_MM = 12.7;
/** Content width of the text column on A4 at the default margins, in points. */
const CONTENT_WIDTH_PT = 450;

const BLOCK_SHADING: Record<string, string> = {
  info: "EAF2FB",
  success: "E9F5EA",
  warning: "FDF3DD",
  error: "FBE9E9",
  aside: "F5F5F4",
  spoiler: "F5F0E6",
  insight: "EDF3EC",
};

const BLOCK_BORDER: Record<string, string> = {
  info: "2F6B57",
  success: "5B6B50",
  warning: "B9794C",
  error: "CF5B47",
  aside: "9A9A94",
  spoiler: "9A8A5A",
  insight: "2F6B57",
};

function twipsFromPx(px: number): number {
  return Math.round((px / 96) * 1440);
}

/** Converts a CSS font-size (px/pt/rem/em) to Word half-points.
 *  Pixels map 1:1 to points so the number picked in the editor (14px) is the
 *  number Word shows (14pt). */
function fontSizeHalfPoints(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^([\d.]+)\s*(px|pt|rem|em)?$/.exec(value.trim());
  if (!match) return undefined;
  const size = Number(match[1]);
  const unit = match[2] ?? "px";
  const points =
    unit === "px" || unit === "pt" ? size : (unit === "rem" || unit === "em" ? size * 12 : size);
  return Math.round(points * 2);
}

/** Global font-size multiplier applied to every run, 1 when no scaling. */
let activeFontFactor = 1;

/** Monospace family for code, from the export theme. */
let activeCodeFont = "Consolas";

/** Surface and ink of code blocks, from the chosen Highlight.js theme. */
let activeCodeSurface = "F5F5F4";

/** Side rule of the callout / custom block currently being converted. */
let activeBlockBorder: string | undefined;

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

/**
 * An equation as Word content: a real math zone, or the LaTeX source when a
 * zone cannot be built from it. An equation is not a monospace italic string —
 * Word would show `\frac{a}{b}` where the reader expects a stacked fraction.
 */
function equationRun(equation: string, display: boolean): XmlComponent {
  return latexToOmml(equation, display) ?? new TextRun({ text: equation, italics: true, font: activeCodeFont });
}

function runFromTextNode(node: TextNode, rtl?: boolean): TextRun {
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
    font: isCode ? activeCodeFont : fontFamily && !generic.includes(fontFamily) ? fontFamily : undefined,
    // Runs of an RTL block are marked `w:rtl` so trailing neutral
    // characters (a final period, for example) resolve as RTL and stay on
    // the same line instead of wrapping to the next one.
    rightToLeft: rtl,
    size: (() => {
      const halfPoints = fontSizeHalfPoints(style.fontSize);
      return halfPoints !== undefined ? Math.round(halfPoints * activeFontFactor) : undefined;
    })(),
    color: parseWordColor(style.color),
    shading: style.backgroundColor
      ? {
          type: ShadingType.CLEAR,
          fill: parseWordColor(style.backgroundColor),
          color: "auto",
        }
      : undefined,
  });
}

type InlineContent = TextRun | ExternalHyperlink | ImageRun | XmlComponent;

function buildRuns(node: LexicalNode, rtl?: boolean, state?: WalkState): InlineContent[] {
  if ($isTextNode(node)) return [runFromTextNode(node, rtl)];
  if ($isLinkNode(node)) {
    return [
      new ExternalHyperlink({
        link: node.getURL(),
        children: node.getChildren().flatMap((child) => buildRuns(child, rtl, state)) as TextRun[],
      }),
    ];
  }
  if ($isEquationNode(node)) {
    // A display equation normally sits at the top level, where `nodeToDocx`
    // gives it its own centred paragraph. One that ended up inside a paragraph
    // still belongs in the flow, so it is emitted here rather than dropped.
    return [equationRun(node.getEquation(), !node.isInline())];
  }
  // An image the author placed inside a paragraph is content, not decoration:
  // dropping it here is how it used to disappear from the file.
  if ($isImageNode(node) && state) {
    const picture = pictureRun(node, state);
    return picture ? [picture] : [];
  }
  if ($isElementNode(node)) {
    return node.getChildren().flatMap((child) => buildRuns(child, rtl, state));
  }
  return [];
}

type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];
type DocxHeadingLevel = (typeof HeadingLevel)[keyof typeof HeadingLevel];

/** The direction a node should be laid out in, resolved the same way the
 *  generic writer resolves it: what the node recorded, then its own text, then
 *  the direction it sits in. The last step is what a table cell needs — a cell
 *  holding a single number has no language of its own, and belongs to the
 *  table it is in. */
function blockDir(node: ElementNode, inherited: TextDir = undefined): TextDir {
  const recorded = node.getDirection();
  return resolveBlockDir(
    recorded === "rtl" || recorded === "ltr" ? recorded : undefined,
    node.getTextContent(),
    inherited,
  );
}

/** The direction properties a paragraph needs. Word keeps them in two places —
 *  the paragraph (`w:bidi`) and the runs (`w:rtl`) — and setting only the first
 *  is what leaves Persian text laid out left-to-right. */
function directionOf(dir: TextDir): { bidirectional: boolean } {
  return { bidirectional: dir === "rtl" };
}

function alignmentFromNode(node: ElementNode, dir: TextDir = blockDir(node)): DocxAlignment | undefined {
  const visual = (() => {
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
        return dir === "rtl" ? AlignmentType.RIGHT : dir === "ltr" ? AlignmentType.LEFT : undefined;
    }
  })();
  // Encoded for Word (see `justificationFor`): an RTL paragraph must not carry
  // a literal `right`, which Word would mirror to the left.
  return justificationFor(visual, dir === "rtl");
}

function codeParagraphs(node: LexicalNode, dir: TextDir): Paragraph[] {
  const rtl = dir === "rtl";
  const size = Math.round(20 * activeFontFactor);
  return node
    .getTextContent()
    .split("\n")
    .map(
      (line) =>
        new Paragraph({
          children: [
            new TextRun({
              text: line || " ",
              font: activeCodeFont,
              size,
              ...(rtl ? { rightToLeft: true } : {}),
            }),
          ],
          ...directionOf(dir),
          shading: { type: ShadingType.CLEAR, fill: activeCodeSurface, color: "auto" },
          spacing: { after: 0 },
        }),
    );
}

function listParagraphs(
  node: LexicalNode,
  depth: number,
  state: WalkState,
  inherited: TextDir,
): DocxChild[] {
  if (!$isListNode(node)) return [];
  const isCheck = node.getListType() === "check";
  const isNumbered = node.getListType() === "number";
  const reference = isNumbered ? "readlynx-ordered" : "readlynx-unordered";
  const out: DocxChild[] = [];
  for (const item of node.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const dir = $isElementNode(item) ? blockDir(item, inherited) : inherited;
    const rtl = dir === "rtl";
    const runs: InlineContent[] = [];
    if (isCheck) {
      runs.push(new TextRun({ text: item.getChecked() ? "☑ " : "☐ ", ...(rtl ? { rightToLeft: true } : {}) }));
    }
    for (const child of item.getChildren()) {
      if ($isListNode(child)) continue;
      runs.push(...buildRuns(child, rtl, state));
    }
    out.push(
      new Paragraph({
        children: runs,
        numbering: isCheck ? undefined : { reference, level: Math.min(depth, MAX_LIST_DEPTH) },
        ...directionOf(dir),
        alignment: $isElementNode(item) ? alignmentFromNode(item, dir) : undefined,
      }),
    );
    for (const child of item.getChildren()) {
      if ($isListNode(child)) out.push(...listParagraphs(child, depth + 1, state, dir));
    }
  }
  return out;
}

/**
 * A table. As in the generic writer, the direction is the whole job: the
 * columns have an order of their own (`w:bidiVisual` moves the first one to the
 * right for a right-to-left table) and every cell's paragraphs carry the
 * `w:bidi` / `w:rtl` pair, so a Persian header and a cell holding nothing but a
 * number both land the way the editor shows them.
 */
function tableChildren(
  node: ElementNode,
  state: WalkState,
  inherited: TextDir,
): Table {
  const tableDir = blockDir(node, inherited);
  const rows = node
    .getChildren()
    .filter($isTableRowNode)
    .map(
      (row) =>
        new TableRow({
          children: row
            .getChildren()
            .filter($isTableCellNode)
            .map((cell) => {
              const content = cell
                .getChildren()
                .flatMap((child) => nodeToDocx(child, state, tableDir)) as Paragraph[];
              return new TableCell({
                children:
                  content.length > 0 ? content : [new Paragraph({ children: [] })],
              });
            }),
        }),
    );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    ...(tableDir === "rtl" ? { visuallyRightToLeft: true } : {}),
    rows,
  });
}

/** The bytes behind an image source, preferring a WebP conversion made before
 *  the walk. */
function decodedImage(src: string, replacements: ReadonlyMap<string, string>): DecodedImage | null {
  return decodeImage(replacements.get(src) ?? src);
}

/** A picture, or `null` when Word cannot be given the bytes behind it. */
function pictureRun(node: ImageNode, state: WalkState): ImageRun | null {
  const decoded = decodedImage(node.getSrc(), state.replacements);
  if (!decoded) return null;
  return imageRun(decoded, {
    maxWidthPt: CONTENT_WIDTH_PT,
    alt: node.getAltText() || undefined,
  });
}

function imageParagraph(node: ImageNode, state: WalkState, dir: TextDir): Paragraph[] {
  const picture = pictureRun(node, state);
  if (!picture) return [];
  return [
    new Paragraph({
      ...directionOf(dir),
      // An image has no text side of its own; in a right-to-left block it
      // follows the block, encoded for Word (a literal `right` would mirror).
      alignment: justificationFor(
        dir === "rtl" ? AlignmentType.RIGHT : AlignmentType.CENTER,
        dir === "rtl",
      ),
      children: [picture],
    }),
  ];
}

/** Headings of a ticked level start a new page, except the first one — the
 *  same rule the PDF paginator applies, so both formats break identically. */
class ChapterBreaks {
  private readonly tags: Set<string>;
  private readonly seen = new Set<string>();

  constructor(levels: readonly number[] | undefined) {
    this.tags = new Set(
      (levels ?? [])
        .map((level) => Math.min(6, Math.max(0, Math.trunc(level))))
        .filter((level) => level > 0)
        .map((level) => `h${level}`),
    );
  }

  startsNewPage(tag: string): boolean {
    if (!this.tags.has(tag)) return false;
    if (this.seen.has(tag)) return true;
    this.seen.add(tag);
    return false;
  }
}

/** What the tree walk needs beyond the node itself. */
interface WalkState {
  chapters: ChapterBreaks;
  /** WebP sources already re-encoded as PNG, keyed by the original source. */
  replacements: ReadonlyMap<string, string>;
}


/** Maps one node to docx content. `inherited` is the direction of the nearest
 *  ancestor that declared one, so a cell of numbers or a caption still lands
 *  where the page it sits on puts it. */
function nodeToDocx(node: LexicalNode, state: WalkState, inherited: TextDir): DocxChild[] {
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
    const dir = blockDir(node, inherited);
    return [
      new Paragraph({
        heading: heading[level],
        children: buildRuns(node, dir === "rtl", state),
        alignment: alignmentFromNode(node, dir),
        ...directionOf(dir),
        ...(state.chapters.startsNewPage(level) ? { pageBreakBefore: true } : {}),
        keepNext: true,
      }),
    ];
  }
  if ($isQuoteNode(node)) {
    const dir = blockDir(node, inherited);
    return [
      new Paragraph({
        children: buildRuns(node, dir === "rtl", state),
        indent: { left: 720 },
        alignment: alignmentFromNode(node, dir),
        ...directionOf(dir),
      }),
    ];
  }
  if ($isCodeNode(node)) {
    return codeParagraphs(node, $isElementNode(node) ? blockDir(node, inherited) : inherited);
  }
  if ($isListNode(node)) {
    return listParagraphs(node, 0, state, $isElementNode(node) ? blockDir(node, inherited) : inherited);
  }
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
  if ($isImageNode(node)) {
    return imageParagraph(node, state, $isElementNode(node) ? blockDir(node, inherited) : inherited);
  }
  if ($isTableNode(node)) return [tableChildren(node, state, inherited)];
  if ($isCalloutNode(node) || $isCustomBlockNode(node)) {
    const tone = $isCalloutNode(node) ? node.getTone() : node.getKind();
    const dir = blockDir(node, inherited);
    const previous = activeBlockBorder;
    activeBlockBorder = BLOCK_BORDER[tone] ?? "2F6B57";
    try {
      return [
        new Paragraph({
          children: buildRuns(node, dir === "rtl", state),
          shading: {
            type: ShadingType.CLEAR,
            fill: BLOCK_SHADING[tone] ?? "F5F5F4",
            color: "auto",
          },
          ...(previous ? {} : { border: { left: { style: BorderStyle.SINGLE, size: 12, color: activeBlockBorder, space: 8 } } }),
          indent: { left: 240, right: 240 },
          alignment: alignmentFromNode(node, dir),
          ...directionOf(dir),
        }),
      ];
    } finally {
      activeBlockBorder = previous;
    }
  }
  // An equation takes no direction: Word lays a math zone out by its own rules.
  if ($isEquationNode(node)) {
    return [
      new Paragraph({
        children: [equationRun(node.getEquation(), true)],
        alignment: AlignmentType.CENTER,
      }),
    ];
  }
  if ($isHtmlBlockNode(node)) {
    const text = node.getTextContent();
    return text ? [new Paragraph({ children: [new TextRun({ text })] })] : [];
  }
  if ($isElementNode(node)) {
    const dir = blockDir(node, inherited);
    return [
      new Paragraph({
        children: buildRuns(node, dir === "rtl", state),
        alignment: alignmentFromNode(node, dir),
        ...directionOf(dir),
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
      text: "•",
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

/** A full-bleed cover page, scaled to the page so nothing is cropped. */
function coverParagraph(cover: DecodedImage, format: PageFormat): Paragraph | null {
  const { width, height } = PAGE_FORMATS[format];
  const pageWidthPt = twipsFromPx(width) / 20;
  const pageHeightPt = twipsFromPx(height) / 20;
  const size = fitImage(cover, { maxWidthPt: pageWidthPt, maxHeightPt: pageHeightPt });
  const picture = imageRun(cover, { maxWidthPt: size.width, maxHeightPt: size.height });
  if (!picture) return null;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [picture],
  });
}

/**
 * Word cannot embed WebP, and it is the format a screenshot or a scan arrives
 * in, so those pictures are re-encoded before the synchronous walk that reads
 * the editor state.
 */
async function convertWebpImages(editor: LexicalEditor): Promise<Map<string, string>> {
  const sources = editor.getEditorState().read(() => {
    const found = new Set<string>();
    const walk = (nodes: readonly LexicalNode[]) => {
      for (const node of nodes) {
        if ($isImageNode(node)) found.add(node.getSrc());
        if ($isElementNode(node)) walk(node.getChildren());
      }
    };
    walk($getRoot().getChildren());
    return [...found];
  });
  const webp = sources.filter((src) => src.startsWith("data:image/webp"));
  const converted = new Map<string, string>();
  await Promise.all(
    webp.map(async (src) => {
      const png = await pngFromWebp(src);
      if (png) converted.set(src, png);
    }),
  );
  return converted;
}

export async function exportDocx(
  editor: LexicalEditor,
  format: PageFormat,
  options: DocxExportOptions = {},
  coverImage?: string,
): Promise<Blob> {
  activeFontFactor = fontScaleFactor(options.fontSizeScalePct);
  activeBlockBorder = undefined;
  const palette = resolveDocxPalette(options);
  activeCodeFont = palette.codeFont;
  activeCodeSurface = palette.codeSurface;

  const replacements = await convertWebpImages(editor);

  const contentChildren = editor.getEditorState().read(() => {
    const state: WalkState = {
      chapters: new ChapterBreaks(options.chapterLevels),
      replacements,
    };
    const root = $getRoot();
    // A document written right-to-left has no direction of its own at the
    // root, so the root's own text decides what its unjudgeable blocks inherit.
    const documentDir = $isElementNode(root) ? blockDir(root) : undefined;
    return root.getChildren().flatMap((node) => nodeToDocx(node, state, documentDir));
  });

  const { width, height } = PAGE_FORMATS[format];
  const margins = options.margins ?? uniformMargins(DEFAULT_MARGIN_MM);
  const toTwips = (mm: number) => Math.round((mm / 25.4) * 1440);

  const coverChildren: DocxChild[] = [];
  const decodedCover = coverImage
    ? decodeImage(replacements.get(coverImage) ?? coverImage)
    : null;
  const cover = decodedCover ? coverParagraph(decodedCover, format) : null;
  if (cover) coverChildren.push(cover);

  const defaultRun: {
    font: string;
    size?: number;
    color?: string;
  } = {
    font: palette.bodyFont,
    // The editor's default body size is 14px; export it as 14pt so text
    // without an explicit size matches what the editor shows.
    size: Math.round(28 * activeFontFactor),
    ...(palette.textColor ? { color: palette.textColor } : {}),
  };

  const pageSize = { width: twipsFromPx(width), height: twipsFromPx(height) };
  const footer = options.showPageNumbers
    ? new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT] })],
          }),
        ],
      })
    : undefined;

  const document = new Document({
    numbering: { config: NUMBERING_CONFIG },
    ...(options.backgroundColor
      ? { background: { color: parseWordColor(options.backgroundColor) ?? "FFFFFF" } }
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
            margin: {
              top: toTwips(margins.top),
              right: toTwips(margins.right),
              bottom: toTwips(margins.bottom),
              left: toTwips(margins.left),
            },
          },
        },
        ...(footer ? { footers: { default: footer } } : {}),
        children: contentChildren,
      },
    ],
  });

  return Packer.toBlob(document);
}
