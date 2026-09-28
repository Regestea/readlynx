import mermaid from "mermaid";
import { mermaidRecoveryLadder } from "../../../components/markdown/mermaidRepair";
import { MERMAID_LIGHT_THEME } from "../../../components/markdown/mermaidTheme";

/**
 * Turns Mermaid sources into images for the exported documents.
 *
 * An exported PDF/EPUB/DOCX cannot run Mermaid, and neither can an `<img>` tag:
 * the diagram has to be rasterized here, in the renderer, while a DOM is still
 * available, and embedded as a data URL — the same treatment the real
 * translation pictures get.
 *
 * One setting does all the work. By default Mermaid draws labels as HTML
 * inside `<foreignObject>`, and browsers deliberately refuse to render a
 * `foreignObject` when the SVG is loaded through `<img>` or painted onto a
 * canvas — the diagram comes out blank. Forcing real SVG `<text>` labels makes
 * the output self-contained, so it survives both the canvas step and every
 * reader downstream.
 */

/** Device pixels per diagram pixel. 2 keeps Persian text and hairlines crisp
 *  in print without quadrupling the file size of a photo-free diagram. */
const PNG_SCALE = 2;

/** Painted behind the diagram. The theme leaves the page transparent, but a
 *  transparent PNG looks wrong in a dark-mode EPUB reader, and printed pages
 *  are white anyway. */
const PAGE_BACKGROUND = "#ffffff";

const createId = (() => {
  let count = 0;
  return () => `mermaid-export-${++count}`;
})();

interface SizedSvg {
  markup: string;
  width: number;
  height: number;
}

/**
 * Normalises Mermaid's svg so the browser reports a real intrinsic size.
 *
 * Mermaid emits a `viewBox` plus a `max-width` cap and no `width`/`height`,
 * which leaves `naturalWidth` at 0 and the canvas blank. The cap is stripped
 * because an `<img>`-loaded SVG cannot see the page's stylesheet anyway.
 */
function prepareSvg(svg: string): SizedSvg | null {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;

  const box = root.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const width = box?.[2] ?? Number.parseFloat(root.getAttribute("width") ?? "");
  const height = box?.[3] ?? Number.parseFloat(root.getAttribute("height") ?? "");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const style = root.getAttribute("style")?.replace(/max-width\s*:[^;]+;?/g, "").trim();
  if (style) root.setAttribute("style", style);
  else root.removeAttribute("style");

  return { markup: new XMLSerializer().serializeToString(root), width, height };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function rasterize({ markup, width, height }: SizedSvg): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(url);
    if (!image) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * PNG_SCALE);
    canvas.height = Math.ceil(height * PNG_SCALE);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = PAGE_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Renders one diagram to a PNG data URL, or `null` when even the lossy repair
 * cannot make it parse. Callers keep the original code block in that case, so a
 * diagram is never silently dropped from the book.
 *
 * Uses the light theme because the image is baked once, before the export
 * dialog knows which template will be applied, and every target format
 * (print, EPUB, DOCX) is read on a light page.
 */
/** Smallest plausible diagram. A source that parses but declares nothing draws a
 *  degenerate box, which is worse in a book than no picture at all. */
const MIN_DIAGRAM_PX = 64;

export async function mermaidToPngDataUrl(chart: string): Promise<string | null> {
  mermaid.initialize({
    startOnLoad: false,
    ...MERMAID_LIGHT_THEME,
    htmlLabels: false,
  });
  // `parse` is much cheaper than `render` (no layout), so the ladder is driven
  // by it and only the accepted source is actually drawn.
  for await (const attempt of mermaidRecoveryLadder(chart, (source) =>
    mermaid.parse(source).then(
      () => true,
      () => false,
    ),
  )) {
    try {
      const { svg } = await mermaid.render(createId(), attempt.source);
      const sized = prepareSvg(svg);
      if (!sized) continue;
      if (sized.width < MIN_DIAGRAM_PX || sized.height < MIN_DIAGRAM_PX) continue;
      const dataUrl = await rasterize(sized);
      if (dataUrl) return dataUrl;
    } catch {
      // The ladder only offers sources the parser accepted; if drawing one
      // still fails, fall through to the next recovery.
    }
  }
  return null;
}
