import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { IParagraphOptions, ImageRun, XmlComponent } from "docx";
import { PAGE_FORMATS, uniformMargins } from "../../shared/document/pageGeometry";
import type { PageFormat } from "../../shared/document/pageGeometry";
import { elementDir, resolveBlockDir } from "../../shared/document/direction";
import type { TextDir } from "../../shared/document/direction";
import { fontScaleFactor } from "./fontScale";
import { highlightBodyCode } from "./epubHighlight";
import { stampChapterBreaksIn } from "./chapterBreaks";
import { justificationFor, parseWordColor, resolveDocxPalette } from "./docxTheme";
import type { DocxAlignment, DocxPalette } from "./docxTheme";
import type { ExportThemeOptions } from "./exportTheme";
import { fitCoverForExport } from "./coverImage";
import {
  decodeImage,
  fitImage,
  imageRun,
  imageRunFromSrc,
  inlineWebpImages,
} from "./docxImage";
import type { DecodedImage } from "./docxImage";
import { latexFromKatexElement, latexToOmml } from "./docxMath";

/**
 * Word document writer for any source that produces semantic HTML.
 *
 * The document editor has its own writer that walks its node tree directly
 * (callouts, custom blocks, per-node direction). This one is the generic
 * counterpart for sources that only have HTML — a translated book, for
 * instance — and it covers what the PDF path renders: headings, paragraphs,
 * nested and task lists, quotes, syntax-highlighted code, tables, callouts and
 * custom blocks, images and diagrams, equations, links, manual and chapter page
 * breaks, a cover page and page numbers.
 *
 * Two facts shape most of the code. A `.docx` is a Word file, not a browser, so
 * anything CSS-shaped (a theme's colours, Highlight.js token spans) becomes an
 * explicit run property, and anything KaTeX-shaped becomes a real math zone.
 * And a `.docx` carries no hierarchy, so every structure the markup does not
 * spell out — a diagram in a `<figure>`, a callout's tone, which headings start
 * a chapter — has to be recovered here, because nothing downstream will look.
 */

type InlineRun = TextRun | ExternalHyperlink | ImageRun | XmlComponent;
type DocxChild = Paragraph | Table;

/** Attributes a pre-pass leaves on an equation so the walk never has to look
 *  for KaTeX markup (or its duplicated text) again. */
const LATEX_ATTR = "data-docx-latex";
const DISPLAY_ATTR = "data-docx-display";

/** Options a DOCX export understands on top of the shared theme. */
export interface DocxExportOptions extends ExportThemeOptions {
  /** Print a centred page number in the footer. */
  showPageNumbers?: boolean;
  /** Heading levels (1-6) whose headings start a new page; empty = no breaks. */
  chapterLevels?: readonly number[];
  /** Cover image data URL, rendered as a full-bleed first page. */
  coverImage?: string;
}

const MONO_FONT = "Consolas";
const MAX_LIST_DEPTH = 4;
const DEFAULT_MARGIN_MM = 12.7;
/** Body text is exported at this point size when nothing else is specified. */
const DEFAULT_BODY_PT = 12;
/** Width of the text column on A4 at the default margins, in points. */
const CONTENT_WIDTH_PT = 450;

/** Headings in half-points, as a fixed ladder independent of the source's
 *  inline `font-size` (which the highlight pass may have left in place). */
const HEADING_HALF_POINTS: Record<number, number> = {
  1: 36,
  2: 30,
  3: 26,
  4: 24,
  5: 22,
  6: 20,
};

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/** Bullet/decimal definitions for nested lists (mirrors the editor's). */
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

/** Surface for the callout and custom-block tones, matching the editor writer
 *  and the tone colours the print stylesheet draws. */
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

/** Inline formatting collected while walking an inline subtree. */
interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** Inline code: monospaced and slightly smaller. */
  code?: boolean;
  sub?: boolean;
  super?: boolean;
  /** Current link target, if any. */
  href?: string;
  /** Colour of the current Highlight.js token, when inside a code block. */
  color?: string;
  /** Half-point size forced on every run of the subtree, as a heading does. */
  size?: number;
  /** Lay the runs out right-to-left. Word needs this on the run as well as on
   *  the paragraph: `w:bidi` gives the paragraph its base direction, `w:rtl`
   *  tells Word the neutral characters around the text (a full stop, a pair of
   *  brackets) belong to that base direction, which is what keeps a Persian
   *  sentence from ending up with its punctuation on the wrong end. */
  rtl?: boolean;
}

function isBlockTag(tag: string): boolean {
  return [
    "address", "article", "aside", "blockquote", "div", "dl", "dd", "dt", "fieldset",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
    "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "ul",
  ].includes(tag);
}

function isVoidTag(tag: string): boolean {
  return ["br", "hr", "img", "col", "input", "source", "track", "wbr"].includes(tag);
}

/** Multiplier applied to every size, from the export's font-size scale. */
let activeFontFactor = 1;

/** Fill applied to every paragraph produced inside a callout or custom block. */
let activeFill: string | undefined;

/** Side rule drawn on the paragraphs of the block currently being converted. */
let activeRule: string | undefined;

function shading(fill: string) {
  return { type: ShadingType.CLEAR, fill, color: "auto" } as const;
}

/** Paragraph options with the enclosing block's tone folded in, so a callout
 *  shades and rules every paragraph it contains. */
function toned(options: IParagraphOptions): IParagraphOptions {
  if (!activeFill) return options;
  return {
    ...options,
    shading: shading(activeFill),
    ...(activeRule
      ? {
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: activeRule, space: 8 },
          },
        }
      : {}),
  };
}

/**
 * Replaces every rendered equation with a marker carrying its LaTeX source.
 *
 * Done once, up front: the walk then recognises an equation by one attribute
 * lookup instead of searching each subtree for KaTeX markup — which matters
 * twice over, because the markup carries the same formula twice (once as
 * MathML, once as the positioned HTML KaTeX draws) and walking it as ordinary
 * text would print that duplication into the Word file.
 */
function markEquations(root: ParentNode): void {
  const candidates = Array.from(
    root.querySelectorAll(`[data-equation], .katex-display, .katex`),
  );
  for (const el of candidates) {
    // An outer `katex-display` is replaced first, which detaches the inner
    // `katex` this list also holds.
    if (!el.isConnected) continue;
    const source = latexFromKatexElement(el);
    if (!source) continue;
    // The tag is kept: a block equation is a `<div>`, an inline one a `<span>`,
    // and the walk decides what to do with it from that.
    const marker = el.ownerDocument.createElement(el.tagName);
    marker.setAttribute(LATEX_ATTR, source.latex);
    marker.setAttribute(DISPLAY_ATTR, String(source.display));
    el.replaceWith(marker);
  }
}

function equationMath(el: Element): { latex: string; display: boolean } | null {
  const latex = el.getAttribute(LATEX_ATTR);
  if (latex === null) return null;
  return { latex, display: el.getAttribute(DISPLAY_ATTR) === "true" };
}

/** The LaTeX of a paragraph whose whole content is one display equation, or
 *  `null` when it holds anything else. */
function soleDisplayEquation(el: Element): string | null {
  const markers = Array.from(el.children).filter((child) => child.hasAttribute(LATEX_ATTR));
  if (markers.length !== 1 || markers[0].getAttribute(DISPLAY_ATTR) !== "true") return null;
  const hasText = Array.from(el.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.nodeValue?.trim()),
  );
  if (hasText) return null;
  return markers[0].getAttribute(LATEX_ATTR);
}

function headingParagraph(
  el: Element,
  level: number,
  theme: DocxPalette,
  pageBreakBefore: boolean,
  dir: TextDir,
): Paragraph {
  return new Paragraph(
    toned({
      heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_6,
      ...directionOf(dir),
      alignment: alignmentFor(el, dir),
      // The rule the paginator applies, so a chapter opens the same page in
      // Word as it does in the PDF.
      ...(pageBreakBefore ? { pageBreakBefore: true } : {}),
      keepNext: true,
      spacing: { before: 240, after: 120 },
      // The level's own size, forced onto the runs, so emphasis inside the
      // heading survives without demoting it to body text.
      children: inlineRuns(
        el,
        {
          size: Math.round((HEADING_HALF_POINTS[level] ?? 22) * activeFontFactor),
          rtl: dir === "rtl",
        },
        theme,
      ),
    }),
  );
}

/** The direction properties a paragraph or table cell needs. Word keeps them
 *  in two places — the paragraph (`w:bidi`) and the runs (`w:rtl`) — and
 *  setting only the first is what leaves Persian text laid out left-to-right. */
function directionOf(dir: TextDir): { bidirectional: boolean; rtl?: boolean } {
  return dir === "rtl" ? { bidirectional: true } : { bidirectional: false };
}

/** The alignment a block should have: the source's own `text-align` first, then
 *  the side its direction puts it on. Without the second half a right-to-left
 *  paragraph inherits the document default and sits against the wrong margin.
 *  Encoded for Word (see `justificationFor`): an RTL paragraph must not carry
 *  a literal `right`, which Word would mirror to the left. */
function alignmentFor(el: Element, dir: TextDir): DocxAlignment | undefined {
  const declared = alignmentFromStyle(el);
  const visual = declared ?? (dir === "rtl" ? AlignmentType.RIGHT : dir === "ltr" ? AlignmentType.LEFT : undefined);
  return justificationFor(visual, dir === "rtl");
}

/** Flattens an inline subtree into docx runs, merging adjacent text so a
 *  single sentence does not explode into dozens of runs. */
function inlineRuns(node: Node, style: RunStyle, theme: DocxPalette): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (text: string) => {
    if (!text) return;
    const font = style.code ? theme.codeFont : theme.bodyFont;
    // A forced size (a heading's ladder) wins over the inline-code shrink; it
    // is the only way a heading keeps its level's size while still carrying
    // the emphasis the author put inside it.
    const size = style.size ?? (style.code ? Math.round(22 * activeFontFactor) : undefined);
    if (style.href) {
      runs.push(
        new ExternalHyperlink({
          link: style.href,
          children: [
            new TextRun({
              text,
              style: "Hyperlink",
              font,
              ...(style.bold ? { bold: true } : {}),
              ...(style.italics ? { italics: true } : {}),
              ...(size !== undefined ? { size } : {}),
              ...(style.rtl ? { rightToLeft: true } : {}),
            }),
          ],
        }),
      );
      return;
    }
    runs.push(
      new TextRun({
        text,
        font,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italics ? { italics: true } : {}),
        ...(style.strike ? { strike: true } : {}),
        ...(style.underline ? { underline: {} } : {}),
        ...(style.sub ? { subScript: true } : {}),
        ...(style.super ? { superScript: true } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(style.rtl ? { rightToLeft: true } : {}),
        ...(style.code ? { shading: shading(theme.inlineCodeSurface) } : {}),
        ...(style.color ? { color: style.color } : {}),
        ...(theme.textColor && !style.color ? { color: theme.textColor } : {}),
      }),
    );
  };

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      push(child.nodeValue ?? "");
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    // Line breaks and images are void but still produce content, so they are
    // handled before the generic void-element skip below.
    if (tag === "br") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (tag === "img") {
      const image = pictureRun(el);
      if (image) runs.push(image);
      continue;
    }
    if (isVoidTag(tag)) continue;
    // An equation is not text: it becomes a Word math zone, or the LaTeX
    // source when a math zone cannot be built from it.
    const equation = equationRuns(el);
    if (equation) {
      runs.push(...equation);
      continue;
    }
    runs.push(
      ...inlineRuns(
        el,
        {
          ...style,
          bold: style.bold || tag === "strong" || tag === "b",
          italics: style.italics || tag === "em" || tag === "i",
          strike: style.strike || tag === "s" || tag === "del" || tag === "strike",
          underline: style.underline || tag === "u",
          code: style.code || tag === "code" || tag === "kbd" || tag === "samp",
          sub: style.sub || tag === "sub",
          super: style.super || tag === "sup",
          href: tag === "a" ? el.getAttribute("href") ?? style.href : style.href,
          // A struck run is muted, as the print stylesheet has it; a token
          // class wins, because inside a code block it is the author's choice.
          color:
            tokenColor(el, theme) ??
            (style.strike || tag === "del" || tag === "s" || tag === "strike"
              ? theme.muted
              : style.color),
        },
        theme,
      ),
    );
  }
  return runs;
}

/** The colour a Highlight.js token class asks for in the chosen code theme, if
 *  this element is one. */
function tokenColor(el: Element, theme: DocxPalette): string | undefined {
  for (const className of Array.from(el.classList)) {
    const color = theme.tokenColors[className];
    if (color) return color;
  }
  return undefined;
}

/** An equation as Word content: a real math zone, or the LaTeX source when the
 *  zone cannot be built. `null` for anything that is not an equation. */
function equationRuns(el: Element): XmlComponent[] | null {
  const source = equationMath(el);
  if (!source) return null;
  const math = latexToOmml(source.latex, source.display);
  if (math) return [math];
  return [latexFallback(source.latex)];
}

/** Shown when an equation cannot become a math zone: the source, monospaced
 *  and italic, which is at least readable and still correct. */
function latexFallback(latex: string): TextRun {
  return new TextRun({
    text: latex,
    font: MONO_FONT,
    italics: true,
    size: Math.round(20 * activeFontFactor),
  });
}

/** An image becomes an `ImageRun` only when the browser can give us its
 *  bytes; everything else is dropped (a Word file cannot reference a URL). */
function pictureRun(el: Element): ImageRun | null {
  return imageRunFromSrc(el.getAttribute("src") ?? "", {
    maxWidthPt: CONTENT_WIDTH_PT,
    alt: el.getAttribute("alt") ?? undefined,
  });
}

/** `text-align` on the source element, as a Word alignment. */
function alignmentFromStyle(
  el: Element,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = (el.getAttribute("style") ?? "").match(/(?:^|;)\s*text-align\s*:\s*([a-z]+)/i)?.[1];
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    case "left":
      return AlignmentType.LEFT;
    default:
      return undefined;
  }
}

function paragraphFrom(el: Element, theme: DocxPalette, dir: TextDir): Paragraph {
  return new Paragraph(
    toned({
      ...directionOf(dir),
      alignment: alignmentFor(el, dir),
      spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
      children: inlineRuns(el, { rtl: dir === "rtl" }, theme),
    }),
  );
}

/** A quoted block: same content, indented and marked with a side rule. */
function quoteParagraph(
  runs: InlineRun[],
  theme: DocxPalette,
  dir: TextDir,
): Paragraph {
  return new Paragraph(
    toned({
      ...directionOf(dir),
      alignment: justificationFor(dir === "rtl" ? AlignmentType.RIGHT : undefined, dir === "rtl"),
      indent: { left: 360, right: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 6, color: theme.accent, space: 8 } },
      spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
      children: runs,
    }),
  );
}

/**
 * Fenced / indented code, one paragraph per source line so the layout
 * survives. The Highlight.js spans the export pass added come along as run
 * colours, so the code theme picked in the dialog applies in Word as well.
 */
function codeParagraphs(el: Element, theme: DocxPalette, dir: TextDir): Paragraph[] {
  const source = el.querySelector("code") ?? el;
  if (!source.textContent?.trim()) return [];
  const rtl = dir === "rtl";
  const surface = shading(theme.codeSurface);
  const size = Math.round(20 * activeFontFactor);
  const line = (children: IParagraphOptions["children"]) =>
    new Paragraph({
      ...directionOf(dir),
      // Inside a callout the block's own fill wins: one surface, not two.
      ...(activeFill ? {} : { shading: surface }),
      spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children,
    });
  return codeLines(source).map((fragment) =>
    fragment
      ? line(inlineRuns(fragment, { code: true, color: theme.codeInk, rtl }, theme))
      : line([new TextRun({ text: " ", font: theme.codeFont, size, ...(rtl ? { rightToLeft: true } : {}) })]),
  );
}

/**
 * A code block's inline tree split at newlines: one entry per source line, or
 * `null` for a blank one, which has no element to carry runs. The split has to
 * happen on the tree rather than on the text so the token spans survive it.
 */
function codeLines(source: Element): (Element | null)[] {
  const doc = source.ownerDocument;
  const lines: Element[] = [];
  let current = doc.createElement("span");
  const flush = () => {
    lines.push(current);
    current = doc.createElement("span");
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const pieces = (child.nodeValue ?? "").split("\n");
        pieces.forEach((piece, index) => {
          if (piece) current.appendChild(doc.createTextNode(piece));
          if (index < pieces.length - 1) flush();
        });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      // The editor's DOM serializer writes code line breaks as `<br>`.
      if ((child as Element).tagName.toLowerCase() === "br") {
        flush();
        continue;
      }
      // A deep clone, walked in place: a shallow one would leave the token
      // spans empty and their text beside them, losing every token colour.
      const copy = (child as Element).cloneNode(true) as Element;
      current.appendChild(copy);
      walk(copy);
    }
  };
  walk(source);
  flush();
  // A trailing newline ends the last line rather than starting another.
  while (lines.length > 1 && lines[lines.length - 1].childNodes.length === 0) lines.pop();
  return lines.map((line) => (line.childNodes.length > 0 ? line : null));
}

function listParagraphs(
  el: Element,
  ordered: boolean,
  depth: number,
  theme: DocxPalette,
  inherited: TextDir,
): DocxChild[] {
  const level = Math.min(depth, MAX_LIST_DEPTH);
  // A GitHub task list carries its state in the list's `type` attribute. Word
  // has no such list, so the tick becomes the item's first character — the
  // same `☑`/`☐` the print stylesheet draws.
  const checklist = el.getAttribute("type") === "check";
  const out: DocxChild[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const dir = resolveBlockDir(elementDir(li), li.textContent ?? "", inherited);
    // Nested lists are pulled out of the item's own paragraph so the marker
    // only covers the item's first line.
    const nested = Array.from(li.children).filter((child) => {
      const tag = child.tagName.toLowerCase();
      return tag === "ul" || tag === "ol";
    });
    const own = Array.from(li.childNodes).filter((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return true;
      const tag = (node as Element).tagName.toLowerCase();
      return tag !== "ul" && tag !== "ol";
    });
    const container = el.ownerDocument.createElement("div");
    for (const node of own) container.appendChild(node.cloneNode(true));

    const runs: InlineRun[] = [];
    if (checklist) {
      // The state lives on the checkbox inside the item, not on the item.
      const box = li.querySelector('input[type="checkbox"]');
      runs.push(
        new TextRun({
          text: box?.hasAttribute("checked") ? "☑ " : "☐ ",
          font: theme.bodyFont,
          ...(dir === "rtl" ? { rightToLeft: true } : {}),
        }),
      );
    }
    runs.push(...inlineRuns(container, { rtl: dir === "rtl" }, theme));
    out.push(
      new Paragraph(
        toned({
          numbering: checklist
            ? undefined
            : { reference: ordered ? "readlynx-ordered" : "readlynx-unordered", level },
          ...directionOf(dir),
          alignment: alignmentFor(li, dir),
          spacing: { after: 60, line: 360, lineRule: LineRuleType.AUTO },
          children: runs,
        }),
      ),
    );
    for (const child of nested) {
      out.push(
        ...listParagraphs(
          child,
          child.tagName.toLowerCase() === "ol",
          level + 1,
          theme,
          dir,
        ),
      );
    }
  }
  return out;
}

/**
 * A table.
 *
 * Direction is the whole job here as far as Word is concerned: a table is the
 * one place where the markup's own `dir` is not enough, because the *columns*
 * have an order of their own. `w:bidiVisual` moves the first column to the
 * right for a right-to-left table, and each cell's paragraph then carries the
 * `w:bidi` and `w:rtl` pair, so a Persian header, a Persian body cell and a
 * cell holding nothing but a number all land the way the PDF lays them out.
 */
function tableChild(
  el: Element,
  theme: DocxPalette,
  inherited: TextDir,
  chapterStarts: ReadonlySet<Element>,
): Table {
  const tableDir = resolveBlockDir(elementDir(el), el.textContent ?? "", inherited);
  const rows = Array.from(el.querySelectorAll("tr"));
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: theme.rule },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: theme.rule },
    left: { style: BorderStyle.SINGLE, size: 2, color: theme.rule },
    right: { style: BorderStyle.SINGLE, size: 2, color: theme.rule },
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    ...(tableDir === "rtl" ? { visuallyRightToLeft: true } : {}),
    rows: rows.map((row, rowIndex) => {
      const header = rowIndex === 0;
      return new TableRow({
        tableHeader: header,
        children: Array.from(row.children).map((cell) => {
          const tag = cell.tagName.toLowerCase();
          if (tag !== "th" && tag !== "td") {
            return new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [] })] });
          }
          const dir = resolveBlockDir(elementDir(cell), cell.textContent ?? "", tableDir);
          // A cell is allowed to hold real content, not just text: a list or a
          // nested table inside one is what the print stylesheet renders too.
          const blocks = Array.from(cell.children).filter((child) =>
            isBlockTag(child.tagName.toLowerCase()),
          );
          const content =
            blocks.length > 0
              ? blocks.flatMap((block) => blockToDocx(block, theme, chapterStarts, dir))
              : [
                  new Paragraph(
                    toned({
                      ...directionOf(dir),
                      alignment: alignmentFor(cell, dir),
                      spacing: { before: 40, after: 40 },
                      children: inlineRuns(cell, { bold: header || tag === "th", rtl: dir === "rtl" }, theme),
                    }),
                  ),
                ];
          return new TableCell({
            borders: cellBorders,
            ...(header ? { shading: shading(theme.tableHead) } : {}),
            children: content.length > 0 ? content : [new Paragraph({ children: [] })],
          });
        }),
      });
    }),
  });
}

/** Maps one block-level element to docx content. `inherited` is the direction
 *  of the nearest ancestor that declared one, so a block the text cannot judge
 *  — a cell of digits, a diagram caption — still lands on the right side of a
 *  right-to-left page. */
function blockToDocx(
  el: Element,
  theme: DocxPalette,
  chapterStarts: ReadonlySet<Element>,
  inherited: TextDir,
): DocxChild[] {
  const tag = el.tagName.toLowerCase();
  const own = elementDir(el);
  const dir = resolveBlockDir(own, el.textContent ?? "", inherited);
  if (el.hasAttribute("data-page-break")) {
    return [new Paragraph({ children: [new PageBreak()] })];
  }
  // An equation is not a paragraph: a display one is centred on its own line,
  // an inline one is still read by `inlineRuns` from the paragraph holding it.
  // Neither takes a direction: a math zone is laid out by Word's own algorithm.
  const equation = equationMath(el);
  if (equation) {
    const math = latexToOmml(equation.latex, equation.display);
    if (math && equation.display) {
      return [new Paragraph({ alignment: AlignmentType.CENTER, children: [math] })];
    }
    return [new Paragraph({ children: equation ? [math ?? latexFallback(equation.latex)] : [] })];
  }
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    return [headingParagraph(el, Number(heading[1]), theme, chapterStarts.has(el), dir)];
  }
  if (tag === "p") {
    // A display equation is a block even when the markdown wrote it inside a
    // paragraph: it gets its own centred line, as it does in the PDF.
    const display = soleDisplayEquation(el);
    if (display) {
      const math = latexToOmml(display, true);
      if (math) return [new Paragraph({ alignment: AlignmentType.CENTER, children: [math] })];
    }
    // A paragraph holding nothing but an image reads better as the image.
    const first = el.firstElementChild;
    const onlyImage =
      el.children.length === 1 && first?.tagName.toLowerCase() === "img" && !el.textContent?.trim();
    if (onlyImage && first) {
      const image = pictureRun(first);
      return image ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [image] })] : [];
    }
    return [paragraphFrom(el, theme, dir)];
  }
  if (tag === "pre") return codeParagraphs(el, theme, resolveBlockDir(own, "", inherited));
  if (tag === "blockquote") {
    const out: DocxChild[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.nodeValue ?? "").trim();
        if (text) {
          out.push(
            quoteParagraph(
              [
                new TextRun({
                  text,
                  font: theme.bodyFont,
                  ...(dir === "rtl" ? { rightToLeft: true } : {}),
                }),
              ],
              theme,
              dir,
            ),
          );
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as Element;
      if (isBlockTag(childEl.tagName.toLowerCase())) {
        out.push(...blockToDocx(childEl, theme, chapterStarts, dir));
        continue;
      }
      const runs = inlineRuns(childEl, { rtl: dir === "rtl" }, theme);
      if (runs.length > 0) out.push(quoteParagraph(runs, theme, dir));
    }
    return out;
  }
  if (tag === "ul" || tag === "ol") {
    return listParagraphs(el, tag === "ol", 0, theme, dir);
  }
  if (tag === "table") return [tableChild(el, theme, inherited, chapterStarts)];
  if (tag === "hr") {
    return [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: theme.rule, space: 1 } },
        spacing: { before: 160, after: 160 },
        children: [],
      }),
    ];
  }
  if (tag === "img") {
    // `pictureRun` directly: `inlineRuns` walks an element's children and an
    // <img> has none, so a standalone image produced nothing at all.
    const image = pictureRun(el);
    return image ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [image] })] : [];
  }
  if (tag === "figcaption") {
    const runs = inlineRuns(el, { color: theme.muted, rtl: dir === "rtl" }, theme);
    if (runs.length === 0) return [];
    return [
      new Paragraph({
        ...directionOf(dir),
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 160 },
        children: runs,
      }),
    ];
  }
  // A callout or a custom block: the tone lives in a data attribute only the
  // print stylesheet reads, so the shading has to be reproduced here.
  const tone = el.getAttribute("data-callout-tone") ?? el.getAttribute("data-block-kind");
  if (tone) {
    return tonedBlocks(el, tone, theme, chapterStarts, dir);
  }
  // Any other container: recurse into its block children.
  if (isBlockTag(tag)) {
    return containerChildren(el, theme, chapterStarts, dir);
  }
  return [];
}

/**
 * A plain container: its block children are converted, and whatever loose text
 * sits between them becomes a paragraph. An `<img>` among them is content, not
 * loose text — without that it was dropped, because `img` is not a block tag,
 * which silently lost every diagram, since those arrive wrapped in a `<figure>`
 * rather than a `<p>`.
 */
function containerChildren(
  el: Element,
  theme: DocxPalette,
  chapterStarts: ReadonlySet<Element>,
  dir: TextDir,
): DocxChild[] {
  const out: DocxChild[] = [];
  let loose = "";
  const flushLoose = () => {
    const text = loose.trim();
    loose = "";
    if (!text) return;
    const looseDir = resolveBlockDir(undefined, text, dir);
    out.push(
      new Paragraph(
        toned({
          ...directionOf(looseDir),
          alignment: justificationFor(
            looseDir === "rtl" ? AlignmentType.RIGHT : undefined,
            looseDir === "rtl",
          ),
          spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
          children: [
            new TextRun({
              text,
              font: theme.bodyFont,
              ...(looseDir === "rtl" ? { rightToLeft: true } : {}),
            }),
          ],
        }),
      ),
    );
  };
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      loose += child.nodeValue ?? "";
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const childTag = (child as Element).tagName.toLowerCase();
    // `pictureRun` is called directly rather than through `inlineRuns`, which
    // walks an element's children and an <img> has none.
    if (childTag === "img") {
      flushLoose();
      const image = pictureRun(child as Element);
      if (image) {
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [image] }));
      }
      continue;
    }
    if (!isBlockTag(childTag)) {
      loose += (child as Element).textContent ?? "";
      continue;
    }
    flushLoose();
    out.push(...blockToDocx(child as Element, theme, chapterStarts, dir));
  }
  flushLoose();
  return out;
}

/** A callout or custom block: its paragraphs take the tone's fill and side
 *  rule — the Word equivalent of the print stylesheet's
 *  `aside[data-callout-tone]` and `section[data-block-kind]`. */
function tonedBlocks(
  el: Element,
  tone: string,
  theme: DocxPalette,
  chapterStarts: ReadonlySet<Element>,
  dir: TextDir,
): DocxChild[] {
  const previousFill = activeFill;
  const previousRule = activeRule;
  activeFill = BLOCK_SHADING[tone] ?? "F5F5F4";
  activeRule = BLOCK_BORDER[tone] ?? theme.accent;
  try {
    // The children, not the element: re-entering `blockToDocx` on the same
    // node would find the very tone attribute that led here.
    return containerChildren(el, theme, chapterStarts, dir);
  } finally {
    activeFill = previousFill;
    activeRule = previousRule;
  }
}

/** The direction the body declares, or the one the whole document does.
 *
 *  A translated book is wrapped in a single `<div dir="rtl">` and its per-block
 *  `dir` attributes are missing from a few block types (`<pre>`, `<figure>`,
 *  callouts). Inheriting that wrapper is what keeps a Persian book's tables,
 *  captions and callouts on the right in Word, where the PDF got it from CSS. */
function documentDir(root: Element | null, body: Element): TextDir {
  return elementDir(body) ?? (root ? elementDir(root) : undefined);
}

/** A full-bleed cover page: the picture scaled to the page, so nothing is
 *  cropped the way the PDF's `object-fit: cover` crops it. */
function coverParagraph(cover: string, format: PageFormat): Paragraph | null {
  const decoded: DecodedImage | null = decodeImage(cover);
  if (!decoded) return null;
  const { width, height } = PAGE_FORMATS[format];
  const pageWidthPt = twipsFromPx(width) / 20;
  const pageHeightPt = twipsFromPx(height) / 20;
  const size = fitImage(decoded, { maxWidthPt: pageWidthPt, maxHeightPt: pageHeightPt });
  const picture = imageRun(decoded, { maxWidthPt: size.width, maxHeightPt: size.height });
  if (!picture) return null;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [picture],
  });
}

/**
 * Builds a `.docx` blob from a semantic HTML body. Throws when the browser
 * cannot parse the markup into a body.
 */
export async function buildDocxFromHtml(
  bodyHtml: string,
  format: PageFormat,
  options: DocxExportOptions = {},
): Promise<Blob> {
  activeFontFactor = fontScaleFactor(options.fontSizeScalePct);
  activeFill = undefined;
  activeRule = undefined;
  const theme = resolveDocxPalette(options);

  // The highlight pass gives code blocks their spans back; reading the text
  // content of the highlighted markup yields the same characters.
  const prepared = highlightBodyCode(bodyHtml);
  const doc = new DOMParser().parseFromString(prepared, "text/html");
  const body = doc.body;
  if (!body) throw new Error("Could not parse the document for DOCX export.");

  // Three passes before the walk: pictures Word cannot read, equations Word
  // cannot typeset, and the headings that start a chapter.
  await inlineWebpImages(body);
  markEquations(body);
  const chapterStarts = new Set<Element>();
  if ((options.chapterLevels?.length ?? 0) > 0) {
    // The very rule the PDF paginator uses: every heading of a ticked level
    // except the first one starts a new page.
    stampChapterBreaksIn(body, options.chapterLevels ?? []);
    for (const marked of Array.from(body.querySelectorAll(".rl-chapter-start"))) {
      chapterStarts.add(marked);
    }
  }

  const contentChildren = Array.from(body.children).flatMap((child) =>
    blockToDocx(child, theme, chapterStarts, documentDir(doc.documentElement, body)),
  );

  const { width, height } = PAGE_FORMATS[format];
  const margins = options.margins ?? uniformMargins(DEFAULT_MARGIN_MM);
  const toTwips = (mm: number) => Math.round((mm / 25.4) * 1440);
  const pageSize = { width: twipsFromPx(width), height: twipsFromPx(height) };

  const cover = options.coverImage
    ? coverParagraph(await fitCoverForExport(options.coverImage), format)
    : null;

  const bodyChildren: DocxChild[] =
    // Word rejects a section with no content, so keep one empty paragraph
    // for a document that produced nothing.
    contentChildren.length > 0 ? contentChildren : [new Paragraph({ children: [] })];

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
          run: {
            font: theme.bodyFont,
            size: Math.round(DEFAULT_BODY_PT * 2 * activeFontFactor),
            ...(theme.textColor ? { color: theme.textColor } : {}),
          },
          paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [
      ...(cover
        ? [
            {
              properties: {
                page: { size: pageSize, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
              },
              children: [cover],
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
        children: bodyChildren,
      },
    ],
  });

  return Packer.toBlob(document);
}
