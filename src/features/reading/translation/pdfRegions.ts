import { OPS, Util } from "pdfjs-dist";
import type { PageViewport, PDFPageProxy } from "pdfjs-dist";

/** Minimal shape of a pdf.js text item (TextItem is not re-exported at the
 *  package root, so this structural type avoids a fragile deep import). */
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Numbered page sections for the PDF AI-vision pipeline.
 *
 * The model is bad at returning x/y coordinates, so the coordinates are
 * produced locally (pdf.js text + image operators) and the model only ever
 * returns integer ids (`[REGION-n]`). Crops are then cut from the clean
 * page image with the stored bounding boxes — never from model output.
 *
 * Boxes are AI-only: the user never sees them. They only need to be roughly
 * around each section with a readable number badge placed in a gap, never
 * on top of the text.
 */

export type PdfRegionLabel = "heading" | "text" | "figure" | "table";

export interface PdfRegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfRegion {
  id: number;
  label: PdfRegionLabel;
  /** Bounding box in clean-image pixels (the canvas the annotated copy is
   *  drawn from, so boxes map 1:1 onto both images). */
  bbox: PdfRegionBox;
}

/** Token the model must emit where a figure/table belongs in the flow. */
export const REGION_TOKEN_RE = /\[REGION-(\d+)\]/g;

/** Clean + annotated page images with the detected sections. Produced by
 *  the viewer (which owns the pdf.js page), consumed by the translation
 *  pipeline. Boxes are in clean-image pixels. */
export interface PdfRegionSnapshot {
  /** High-res clean render — crops are cut from this. */
  clean: string;
  /** Same render with red boxes + number badges — sent to the AI. */
  annotated: string;
  regions: PdfRegion[];
  width: number;
  height: number;
}

/** FileStore chapter key for crops of one PDF page. */
export const pdfRegionPageKey = (page: number): string => `pdf-page-${page}`;

/** Padding (px, at ~1240px page width) drawn around a box and added to crops. */
const BOX_PAD = 8;

interface TextLine {
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
}

function clampBox(box: PdfRegionBox, pageW: number, pageH: number): PdfRegionBox {
  const x = Math.min(Math.max(0, box.x), pageW);
  const y = Math.min(Math.max(0, box.y), pageH);
  const w = Math.min(Math.max(0, box.w), pageW - x);
  const h = Math.min(Math.max(0, box.h), pageH - y);
  return { x, y, w, h };
}

function union(a: PdfRegionBox, b: PdfRegionBox): PdfRegionBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function overlaps(a: PdfRegionBox, b: PdfRegionBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function median(values: number[]): number {
  if (values.length === 0) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Text lines of the page in viewport (canvas-pixel) coordinates. */
async function extractTextLines(
  page: PDFPageProxy,
  viewport: PageViewport,
): Promise<TextLine[]> {
  const content = await page.getTextContent();
  const lines: TextLine[] = [];
  const scale = viewport.scale || 1;
  for (const raw of content.items) {
    if (!raw || typeof (raw as PdfTextItem).str !== "string") continue;
    const item = raw as PdfTextItem;
    const str = item.str;
    if (!str || !str.trim()) continue;
    let tx: number[];
    try {
      tx = Util.transform(viewport.transform, item.transform);
    } catch {
      continue;
    }
    const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
    if (!(fontHeight > 0) || !Number.isFinite(tx[4]) || !Number.isFinite(tx[5])) continue;
    let w = (item.width || 0) * scale;
    if (!(w > 0) || w > viewport.width) {
      // Fallback when the advance width is missing or in unexpected units:
      // rough estimate from the string length (absorbed by box padding).
      w = Math.min(viewport.width, Math.max(fontHeight, fontHeight * 0.5 * str.length));
    }
    lines.push({ x: tx[4], y: tx[5] - fontHeight, w, h: fontHeight, str });
  }
  return lines;
}

interface TextBlock {
  box: PdfRegionBox;
  lineHeights: number[];
  lineCount: number;
  text: string;
}

/** Groups lines into section-level blocks by vertical gaps (Word exports are
 *  single-column, so paragraph spacing reliably separates sections). */
function clusterTextBlocks(lines: TextLine[], pageW: number, pageH: number): TextBlock[] {
  const sorted = [...lines].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const blocks: TextBlock[] = [];
  for (const line of sorted) {
    const box = clampBox({ x: line.x, y: line.y, w: line.w, h: line.h }, pageW, pageH);
    if (box.w <= 0 || box.h <= 0) continue;
    const last = blocks[blocks.length - 1];
    if (last) {
      const gap = box.y - (last.box.y + last.box.h);
      const refH = Math.min(box.h, median(last.lineHeights));
      // Same block while lines follow paragraph line-spacing; a larger gap
      // (Word paragraph spacing) starts a new section.
      if (gap <= Math.max(6, refH * 1.5)) {
        last.box = union(last.box, box);
        last.lineHeights.push(box.h);
        last.lineCount += 1;
        last.text += ` ${line.str}`;
        continue;
      }
    }
    blocks.push({ box, lineHeights: [box.h], lineCount: 1, text: line.str });
  }
  return blocks;
}

/** Drops margin-only page numbers (`"12"` in the top/bottom strip). */
function isPageNumberArtifact(block: TextBlock, pageH: number): boolean {
  const inTopMargin = block.box.y + block.box.h < pageH * 0.06;
  const inBottomMargin = block.box.y > pageH * 0.94;
  if (!inTopMargin && !inBottomMargin) return false;
  return /^\d{1,4}$/.test(block.text.trim());
}

/** Fraction of `box` covered by text (0..1). Used to tell diagrams apart
 *  from table rulings / underlines drawn over translatable text. */
function textOverlapFraction(box: PdfRegionBox, textBoxes: PdfRegionBox[]): number {
  if (box.w <= 0 || box.h <= 0) return 0;
  let covered = 0;
  for (const text of textBoxes) {
    const ix = Math.max(0, Math.min(box.x + box.w, text.x + text.w) - Math.max(box.x, text.x));
    const iy = Math.max(0, Math.min(box.y + box.h, text.y + text.h) - Math.max(box.y, text.y));
    covered += ix * iy;
  }
  return Math.min(1, covered / (box.w * box.h));
}

/** Maps user-space points through the CTM into viewport (canvas) pixels. */
function userPointsToViewportBox(
  points: Array<[number, number]>,
  ctm: number[],
  viewport: PageViewport,
  pageW: number,
  pageH: number,
): PdfRegionBox {
  const mapped = points.map(([u, v]) => {
    const xUser = ctm[0] * u + ctm[2] * v + ctm[4];
    const yUser = ctm[1] * u + ctm[3] * v + ctm[5];
    return viewport.convertToViewportPoint(xUser, yUser) as number[];
  });
  const xs = mapped.map((p) => p[0]);
  const ys = mapped.map((p) => p[1]);
  return clampBox(
    {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    },
    pageW,
    pageH,
  );
}

/** Visual (untranslatable) boxes via one operator-list pass with a minimal
 *  CTM tracker (save/restore, transform concat, Form XObject matrices):
 *  raster images plus vector diagrams/charts (Word charts export as vector
 *  paths, not raster images). Vector candidates must be large, not cover a
 *  full page background, and mostly avoid text — table rulings and heading
 *  underlines stay with their translatable text instead of becoming crops. */
async function extractVisualBoxes(
  page: PDFPageProxy,
  viewport: PageViewport,
  textBoxes: PdfRegionBox[],
): Promise<PdfRegionBox[]> {
  const pageW = viewport.width;
  const pageH = viewport.height;
  const pageArea = pageW * pageH;
  let opList;
  try {
    opList = await page.getOperatorList();
  } catch {
    return [];
  }
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObjectGroup,
  ]);
  const paintOps = new Set([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const discardOps = new Set([OPS.endPath, OPS.clip, OPS.eoClip]);
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const boxes: PdfRegionBox[] = [];
  /** Current vector path in user space (reset on paint / discard). */
  let path: Array<[number, number]> = [];
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    try {
      if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        const prev = stack.pop();
        if (prev) ctm = prev;
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = Util.transform(ctm, args as number[]);
      } else if (fn === OPS.paintFormXObjectBegin) {
        stack.push([...ctm]);
        const matrix = args?.[0];
        if (Array.isArray(matrix) && matrix.length >= 6) {
          ctm = Util.transform(ctm, matrix as number[]);
        }
      } else if (fn === OPS.paintFormXObjectEnd) {
        const prev = stack.pop();
        if (prev) ctm = prev;
      } else if (imageOps.has(fn)) {
        const box = userPointsToViewportBox(
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          ctm,
          viewport,
          pageW,
          pageH,
        );
        // Ignore hairline masks / tiny icons.
        if (box.w >= 24 && box.h >= 24 && box.w * box.h >= pageArea * 0.0005) {
          boxes.push(box);
        }
      } else if (
        fn === OPS.moveTo ||
        fn === OPS.lineTo ||
        fn === OPS.curveTo ||
        fn === OPS.curveTo2 ||
        fn === OPS.curveTo3 ||
        fn === OPS.rectangle
      ) {
        if (Array.isArray(args)) {
          const nums = (args as unknown[]).filter(
            (n): n is number => typeof n === "number" && Number.isFinite(n),
          );
          if (fn === OPS.rectangle && nums.length >= 4) {
            const [x, y, w, h] = nums;
            path.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
          } else {
            for (let k = 0; k + 1 < nums.length; k += 2) path.push([nums[k], nums[k + 1]]);
          }
        }
      } else if (paintOps.has(fn)) {
        // A painted path with real extent is a candidate diagram — but only
        // when it is mostly free of text (table grids / underlines belong to
        // the text and must stay translatable, not become crops).
        if (path.length >= 2) {
          const box = userPointsToViewportBox(path, ctm, viewport, pageW, pageH);
          const area = box.w * box.h;
          if (
            box.w >= 40 &&
            box.h >= 40 &&
            area >= pageArea * 0.015 &&
            area <= pageArea * 0.85 &&
            textOverlapFraction(box, textBoxes) < 0.35
          ) {
            boxes.push(box);
          }
        }
        path = [];
      } else if (discardOps.has(fn)) {
        path = [];
      }
    } catch {
      // One bad operator must not kill section detection.
    }
  }
  // Merge boxes of the same figure (tiled image parts and the strokes of
  // one vector diagram overlap).
  const merged: PdfRegionBox[] = [];
  for (const box of boxes) {
    const target = merged.find((m) => overlaps(m, box));
    if (target) {
      const united = union(target, box);
      target.x = united.x;
      target.y = united.y;
      target.w = united.w;
      target.h = united.h;
    } else {
      merged.push({ ...box });
    }
  }
  return merged;
}

/**
 * Detects numbered sections of a born-digital page (Word-like PDFs).
 * Returns regions in reading order (top→bottom, left→right) with 1-based ids.
 */
export async function extractPdfRegions(
  page: PDFPageProxy,
  viewport: PageViewport,
): Promise<PdfRegion[]> {
  const pageW = viewport.width;
  const pageH = viewport.height;
  const lines = await extractTextLines(page, viewport).catch(() => [] as TextLine[]);
  const docMedianH = median(lines.map((l) => l.h));
  const unlabeled: Array<{ label: PdfRegionLabel; bbox: PdfRegionBox }> = [];

  for (const block of clusterTextBlocks(lines, pageW, pageH)) {
    if (isPageNumberArtifact(block, pageH)) continue;
    if (block.box.w <= 2 || block.box.h <= 2) continue;
    const singleLine = block.lineCount === 1;
    const tall = median(block.lineHeights) > docMedianH * 1.25;
    const shortText = block.text.trim().length <= 120;
    unlabeled.push({
      label: singleLine && tall && shortText ? "heading" : "text",
      bbox: block.box,
    });
  }
  // Visual detection runs after text: vector candidates are filtered against
  // the text boxes, so translatable content (tables, underlined headings)
  // never becomes a crop — only genuinely untranslatable figures do.
  const textBoxes = unlabeled.map((region) => region.bbox);
  const figures = await extractVisualBoxes(page, viewport, textBoxes).catch(
    () => [] as PdfRegionBox[],
  );
  for (const box of figures) {
    unlabeled.push({ label: "figure", bbox: box });
  }
  if (unlabeled.length === 0) return [];

  // Reading order: top→bottom bands, left→right inside a band.
  const bandH = Math.max(12, docMedianH * 0.9);
  unlabeled.sort((a, b) => {
    const bandA = Math.floor(a.bbox.y / bandH);
    const bandB = Math.floor(b.bbox.y / bandH);
    if (bandA !== bandB) return bandA - bandB;
    if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
    return a.bbox.x - b.bbox.x;
  });
  return unlabeled.map((region, index) => ({ ...region, id: index + 1 }));
}

/**
 * Draws red section boxes with number badges onto a copy of the clean page
 * canvas. The badge is placed in the gap above the box when there is room,
 * otherwise top-left inside with an opaque fill — never bare text over the
 * page content, so the numbers stay readable for the model without hiding
 * words underneath.
 */
export function annotateRegions(source: HTMLCanvasElement, regions: PdfRegion[]): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  if (regions.length === 0) return out;

  const unit = Math.max(2, Math.round(out.width / 620));
  const badgeH = Math.max(22, Math.round(out.width * 0.032));
  ctx.lineWidth = unit;
  ctx.strokeStyle = "#d92d20";
  ctx.textBaseline = "middle";

  regions.forEach((region) => {
    const { x, y, w, h } = region.bbox;
    ctx.strokeStyle = "#d92d20";
    ctx.strokeRect(x + unit / 2, y + unit / 2, Math.max(1, w - unit), Math.max(1, h - unit));

    const label = String(region.id);
    ctx.font = `700 ${Math.round(badgeH * 0.55)}px Inter, system-ui, sans-serif`;
    const textW = ctx.measureText(label).width;
    const badgeW = Math.ceil(textW + badgeH * 0.7);
    const aboveFits = y - badgeH - 4 >= 0;
    const bx = Math.min(Math.max(0, x), out.width - badgeW);
    const by = aboveFits ? y - badgeH - 2 : Math.min(y + 2, out.height - badgeH);
    ctx.fillStyle = "#d92d20";
    ctx.fillRect(bx, by, badgeW, badgeH);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, bx + (badgeW - textW) / 2, by + badgeH / 2 + 1);
  });
  return out;
}

/** Cuts one region out of a clean page data URL (with padding, clamped). */
export function cropRegionToDataUrl(
  cleanDataUrl: string,
  bbox: PdfRegionBox,
  naturalW: number,
  naturalH: number,
  pad = BOX_PAD,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const sx = img.naturalWidth / naturalW;
        const sy = img.naturalHeight / naturalH;
        const x = Math.max(0, Math.floor((bbox.x - pad) * sx));
        const y = Math.max(0, Math.floor((bbox.y - pad) * sy));
        const w = Math.min(img.naturalWidth - x, Math.ceil((bbox.w + pad * 2) * sx));
        const h = Math.min(img.naturalHeight - y, Math.ceil((bbox.h + pad * 2) * sy));
        if (w <= 0 || h <= 0) {
          resolve(null);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = cleanDataUrl;
  });
}

/** Ids referenced by `[REGION-n]` tokens, in order of first appearance. */
export function collectRegionTokenIds(markdown: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  REGION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REGION_TOKEN_RE.exec(markdown)) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Replaces each `[REGION-n]` token with the markdown image for that id.
 *  The first occurrence wins — repeated uses of the same image are dropped,
 *  so a figure can never appear twice in the output. */
export function replaceRegionTokens(
  markdown: string,
  markdownById: Map<number, string>,
): string {
  const seen = new Set<number>();
  return markdown.replace(REGION_TOKEN_RE, (_token, rawId: string) => {
    const id = Number(rawId);
    const replacement = markdownById.get(id);
    if (!replacement || seen.has(id)) return "";
    seen.add(id);
    return replacement;
  });
}
