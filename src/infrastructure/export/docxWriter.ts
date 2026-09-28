import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PAGE_FORMATS, uniformMargins } from "../../shared/document/pageGeometry";
import type { PageFormat } from "../../shared/document/pageGeometry";
import { isRtlDominant } from "../../shared/document/direction";
import { fontScaleFactor } from "./fontScale";
import { highlightBodyCode } from "./epubHighlight";
import type { ExportThemeOptions } from "./exportTheme";

/**
 * Word document writer for any source that produces semantic HTML.
 *
 * The document editor has its own richer writer that walks its node tree
 * directly (callouts, custom blocks, per-node direction). This one is the
 * generic counterpart for sources that only have HTML — a translated book, for
 * instance — covering the structures an exported book is made of: headings,
 * paragraphs, nested lists, quotes, code, tables, images, links and inline
 * emphasis.
 */

type InlineRun = TextRun | ExternalHyperlink | ImageRun;
type DocxChild = Paragraph | Table;

const MONO_FONT = "Consolas";
const MAX_LIST_DEPTH = 4;
const DEFAULT_MARGIN_MM = 12.7;
/** Body text is exported at this point size when nothing else is specified. */
const DEFAULT_BODY_PT = 12;

const GENERIC_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy"]);

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

/** Word wants a 6-digit hex colour without the leading `#`. */
function parseColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const match = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (match) return match[1].toUpperCase();
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(trimmed);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return undefined;
}

function twipsFromPx(px: number): number {
  return Math.round((px / 96) * 1440);
}

/** First family name from a CSS font-family list, or the fallback. */
function concreteFont(value: string | undefined, fallback: string): string {
  const first = value
    ?.split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return first && !GENERIC_FAMILIES.has(first.toLowerCase()) ? first : fallback;
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

function headingParagraph(
  el: Element,
  level: number,
  bodyFont: string,
  fallbackColor: string | undefined,
): Paragraph {
  const size = Math.round((HEADING_HALF_POINTS[level] ?? 22) * activeFontFactor);
  const text = (el.textContent ?? "").trim();
  return new Paragraph({
    heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_6,
    bidirectional: isRtlDominant(text),
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        font: bodyFont,
        size,
        bold: true,
        ...(fallbackColor ? { color: fallbackColor } : {}),
      }),
    ],
  });
}

/** Flattens an inline subtree into docx runs, merging adjacent text so a
 *  single sentence does not explode into dozens of runs. */
function inlineRuns(
  node: Node,
  style: RunStyle,
  bodyFont: string,
  fallbackColor: string | undefined,
): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (text: string) => {
    if (!text) return;
    if (style.href) {
      runs.push(
        new ExternalHyperlink({
          link: style.href,
          children: [
            new TextRun({
              text,
              style: "Hyperlink",
              font: style.code ? MONO_FONT : bodyFont,
              ...(style.bold ? { bold: true } : {}),
              ...(style.italics ? { italics: true } : {}),
              ...(style.code ? { size: Math.round(22 * activeFontFactor) } : {}),
            }),
          ],
        }),
      );
      return;
    }
    runs.push(
      new TextRun({
        text,
        font: style.code ? MONO_FONT : bodyFont,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italics ? { italics: true } : {}),
        ...(style.strike ? { strike: true } : {}),
        ...(style.underline ? { underline: {} } : {}),
        ...(style.sub ? { subScript: true } : {}),
        ...(style.super ? { superScript: true } : {}),
        ...(style.code ? { size: Math.round(22 * activeFontFactor) } : {}),
        ...(fallbackColor ? { color: fallbackColor } : {}),
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
      const image = imageRun(el);
      if (image) runs.push(image);
      continue;
    }
    if (isVoidTag(tag)) continue;
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
        },
        bodyFont,
        fallbackColor,
      ),
    );
  }
  return runs;
}

/** An image becomes an `ImageRun` only when the browser can give us its
 *  bytes; everything else is dropped (a Word file cannot reference a URL). */
function imageRun(el: Element): ImageRun | null {
  const raw = el.getAttribute("src") ?? "";
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(raw);
  if (!match) return null;
  const kind = match[1].toLowerCase() === "jpg" ? "jpg" : match[1].toLowerCase();
  if (kind !== "png" && kind !== "jpg" && kind !== "gif") return null;
  try {
    const binary = atob(match[2]);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    // Content width of an A4 page at the default margins, in points.
    const maxWidthPt = 450;
    const alt = el.getAttribute("alt") ?? "";
    return new ImageRun({
      type: kind,
      data,
      ...(alt ? { altText: { name: alt, description: alt, title: alt } } : {}),
      transformation: { width: Math.round(maxWidthPt), height: Math.round(maxWidthPt * 0.6) },
    });
  } catch {
    return null;
  }
}

function paragraphFrom(
  el: Element,
  bodyFont: string,
  fallbackColor: string | undefined,
): Paragraph {
  const text = el.textContent ?? "";
  return new Paragraph({
    bidirectional: isRtlDominant(text),
    spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
    children: inlineRuns(el, {}, bodyFont, fallbackColor),
  });
}

/** A quoted block: same content, indented and marked with a side rule. */
function quoteParagraph(runs: InlineRun[], text: string): Paragraph {
  return new Paragraph({
    bidirectional: isRtlDominant(text),
    indent: { left: 360, right: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 6, color: "B9B9B4", space: 8 } },
    spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
    children: runs,
  });
}

/** Fenced / indented code, one paragraph per line so the layout survives. */
function codeParagraphs(el: Element): Paragraph[] {
  const text = (el.textContent ?? "").replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return [];
  const rtl = isRtlDominant(text);
  return text.split("\n").map(
    (line) =>
      new Paragraph({
        ...(rtl ? { bidirectional: true } : {}),
        shading: { type: ShadingType.CLEAR, fill: "F4F4F2" },
        spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [new TextRun({ text: line || " ", font: MONO_FONT, size: Math.round(20 * activeFontFactor) })],
      }),
  );
}

function listParagraphs(
  el: Element,
  ordered: boolean,
  depth: number,
  bodyFont: string,
  fallbackColor: string | undefined,
): DocxChild[] {
  const level = Math.min(depth, MAX_LIST_DEPTH);
  const out: DocxChild[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
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
    const container = document.createElement("div");
    for (const node of own) container.appendChild(node.cloneNode(true));

    out.push(
      new Paragraph({
        numbering: { reference: ordered ? "readlynx-ordered" : "readlynx-unordered", level },
        bidirectional: isRtlDominant(li.textContent ?? ""),
        spacing: { after: 60, line: 360, lineRule: LineRuleType.AUTO },
        children: inlineRuns(container, {}, bodyFont, fallbackColor),
      }),
    );
    for (const child of nested) {
      out.push(
        ...listParagraphs(
          child,
          child.tagName.toLowerCase() === "ol",
          level + 1,
          bodyFont,
          fallbackColor,
        ),
      );
    }
  }
  return out;
}

function tableChild(el: Element, bodyFont: string, fallbackColor: string | undefined): Table {
  const rows = Array.from(el.querySelectorAll("tr"));
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: "D6D6D2" },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: "D6D6D2" },
    left: { style: BorderStyle.SINGLE, size: 2, color: "D6D6D2" },
    right: { style: BorderStyle.SINGLE, size: 2, color: "D6D6D2" },
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => {
      const header = rowIndex === 0;
      return new TableRow({
        tableHeader: header,
        children: Array.from(row.children).map((cell) => {
          const tag = cell.tagName.toLowerCase();
          if (tag === "th" || tag === "td") {
            return new TableCell({
              borders: cellBorders,
              ...(header
                ? { shading: { type: ShadingType.CLEAR, fill: "EFEFEC" } }
                : {}),
              children: [
                new Paragraph({
                  spacing: { before: 40, after: 40 },
                  children: inlineRuns(
                    cell,
                    { bold: header || tag === "th" },
                    bodyFont,
                    fallbackColor,
                  ),
                }),
              ],
            });
          }
          return new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [] })] });
        }),
      });
    }),
  });
}

/** Maps one block-level element to docx content. */
function blockToDocx(
  el: Element,
  bodyFont: string,
  fallbackColor: string | undefined,
): DocxChild[] {
  const tag = el.tagName.toLowerCase();
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return [headingParagraph(el, Number(heading[1]), bodyFont, fallbackColor)];
  if (tag === "p") {
    // A paragraph holding nothing but an image reads better as the image.
    const first = el.firstElementChild;
    const onlyImage =
      el.children.length === 1 && first?.tagName.toLowerCase() === "img" && !el.textContent?.trim();
    if (onlyImage) {
      const runs = inlineRuns(el, {}, bodyFont, fallbackColor);
      return runs.length
        ? [new Paragraph({ alignment: AlignmentType.CENTER, children: runs })]
        : [];
    }
    return [paragraphFrom(el, bodyFont, fallbackColor)];
  }
  if (tag === "pre") return codeParagraphs(el);
  if (tag === "blockquote") {
    const out: DocxChild[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.nodeValue ?? "").trim();
        if (text) {
          out.push(quoteParagraph([new TextRun({ text, font: bodyFont })], text));
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as Element;
      const runs = inlineRuns(childEl, {}, bodyFont, fallbackColor);
      if (runs.length > 0) out.push(quoteParagraph(runs, childEl.textContent ?? ""));
    }
    return out;
  }
  if (tag === "ul" || tag === "ol") {
    return listParagraphs(el, tag === "ol", 0, bodyFont, fallbackColor);
  }
  if (tag === "table") return [tableChild(el, bodyFont, fallbackColor)];
  if (tag === "hr") {
    return [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "C9C9C4", space: 1 } },
        spacing: { before: 160, after: 160 },
        children: [],
      }),
    ];
  }
  if (tag === "img") {
    // `imageRun` directly: `inlineRuns` walks an element's children and an
    // <img> has none, so a standalone image produced nothing at all.
    const image = imageRun(el);
    return image ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [image] })] : [];
  }
  // Any other container: recurse into its block children.
  if (isBlockTag(tag)) {
    const children = Array.from(el.childNodes);
    const out: DocxChild[] = [];
    let loose = "";
    const flushLoose = () => {
      const text = loose.trim();
      loose = "";
      if (!text) return;
      out.push(
        new Paragraph({
          spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text, font: bodyFont })],
        }),
      );
    };
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        loose += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childTag = (child as Element).tagName.toLowerCase();
      // An image is content, not loose text. Without this it fell through to
      // the branch below and was dropped, because `img` is not a block tag —
      // which silently lost every diagram, since those arrive wrapped in a
      // <figure> rather than a <p>. `imageRun` is called directly rather than
      // via `inlineRuns`, which walks an element's children and an <img> has
      // none.
      if (childTag === "img") {
        flushLoose();
        const image = imageRun(child as Element);
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
      out.push(...blockToDocx(child as Element, bodyFont, fallbackColor));
    }
    flushLoose();
    return out;
  }
  return [];
}

/**
 * Builds a `.docx` blob from a semantic HTML body. Throws when the browser
 * cannot parse the markup into a body.
 */
export async function buildDocxFromHtml(
  bodyHtml: string,
  format: PageFormat,
  options: ExportThemeOptions = {},
): Promise<Blob> {
  activeFontFactor = fontScaleFactor(options.fontSizeScalePct);
  // The highlight pass gives code blocks their spans back; reading the text
  // content of the highlighted markup yields the same characters.
  const prepared = highlightBodyCode(bodyHtml);
  const doc = new DOMParser().parseFromString(prepared, "text/html");
  const body = doc.body;
  if (!body) throw new Error("Could not parse the document for DOCX export.");

  const bodyFont = concreteFont(options.fontFamily, "Calibri");
  const textColor = parseColor(options.textColor);
  const contentChildren = Array.from(body.children).flatMap((child) =>
    blockToDocx(child, bodyFont, textColor),
  );

  const { width, height } = PAGE_FORMATS[format];
  const margins = options.margins ?? uniformMargins(DEFAULT_MARGIN_MM);
  const toTwips = (mm: number) => Math.round((mm / 25.4) * 1440);

  const document = new Document({
    numbering: { config: NUMBERING_CONFIG },
    ...(options.backgroundColor
      ? { background: { color: parseColor(options.backgroundColor) ?? "FFFFFF" } }
      : {}),
    styles: {
      default: {
        document: {
          run: {
            font: bodyFont,
            size: Math.round(DEFAULT_BODY_PT * 2 * activeFontFactor),
            ...(textColor ? { color: textColor } : {}),
          },
          paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: twipsFromPx(width), height: twipsFromPx(height) },
            margin: {
              top: toTwips(margins.top),
              right: toTwips(margins.right),
              bottom: toTwips(margins.bottom),
              left: toTwips(margins.left),
            },
          },
        },
        // Word rejects a section with no content, so keep one empty paragraph
        // for a document that produced nothing.
        children: contentChildren.length > 0 ? contentChildren : [new Paragraph({ children: [] })],
      },
    ],
  });

  return Packer.toBlob(document);
}
