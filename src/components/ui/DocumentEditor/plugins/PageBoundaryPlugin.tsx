import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { PAGE_FORMATS } from "../constants";
import type { PageFormat } from "../constants";
import styles from "../DocumentEditor.module.css";

export interface PageBoundaryPluginProps {
  format: PageFormat;
  zoom: number;
  marginY?: number;
  onPageCountChange?: (count: number) => void;
}

/**
 * Draws exact PDF page-break lines for the paged editor.
 *
 * PDF pages are fixed-height sheets, but on screen the document is one
 * continuous flow, so a block can straddle a fixed sheet boundary. Instead of
 * a fixed grid (which would cut through text), this plugin walks the rendered
 * block layout the same way the PDF engine does — a block overflows to the
 * next page when it no longer fits — and draws a hairline exactly where the
 * text breaks: centered in the whitespace between the last block that fits on
 * a page and the first block of the next page, so it has balanced padding
 * above and below and never touches the text.
 *
 * The whitespace itself comes from a fixed margin the plugin applies to the
 * first block of every page, so the boundary reads as a real page gap instead
 * of the ~11px natural paragraph spacing. The assignment is recomputed on
 * every pass and converges to a stable layout, so it never oscillates; layout
 * shifts only happen at break points and the browser's scroll anchoring keeps
 * the caret in view while typing. Positions are measured in viewport pixels
 * and converted into the paper's pre-zoom coordinate space so they stay
 * correct under CSS `zoom`.
 */
export function PageBoundaryPlugin({
  format,
  zoom,
  marginY = 48,
  onPageCountChange,
}: PageBoundaryPluginProps) {
  const [editor] = useLexicalComposerContext();
  const rafRef = useRef(0);
  const lastPageCountRef = useRef<number>(0);

  useEffect(() => {
    const pageBreakGap = marginY * 2;
    let resizeObserver: ResizeObserver | null = null;
    const appliedMargins = new WeakMap<HTMLElement, number>();
    const touched = new Set<HTMLElement>();

    const render = () => {
      rafRef.current = 0;
      const rootEl = editor.getRootElement();
      if (!rootEl) return;
      const paper = rootEl.parentElement;
      if (!paper) return;
      const overlay = paper.querySelector<HTMLElement>("[data-page-boundaries]");
      if (!overlay) return;

      const contentLimit = PAGE_FORMATS[format].height - marginY * 2;
      const visualScale = parseFloat(getComputedStyle(paper).zoom) || 1;
      const paperRect = paper.getBoundingClientRect();

      const lines: Array<{ center: number; height: number }> = [];
      let stripCount = 0;
      let pageFirstTop: number | null = null;
      let pageLastBottom: number | null = null;
      let previousWasStrip = false;

      for (const child of Array.from(rootEl.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.hasAttribute("data-page-break")) {
          stripCount += 1;
          pageFirstTop = null;
          pageLastBottom = null;
          previousWasStrip = true;
          continue;
        }
        const rect = child.getBoundingClientRect();
        if (rect.height <= 0) continue;
        const top = (rect.top - paperRect.top) / visualScale;
        const bottom = top + rect.height / visualScale;
        if (pageFirstTop === null) pageFirstTop = top;
        let desiredMargin = 0;
        if (bottom - pageFirstTop > contentLimit) {
          if (pageLastBottom !== null) {
            const gap = Math.max(0, top - pageLastBottom);
            lines.push({
              center: pageLastBottom + gap / 2,
              height: gap > 0 ? Math.min(10, gap) : 10,
            });
            if (!previousWasStrip) desiredMargin = pageBreakGap;
          }
          pageFirstTop = top;
        }
        pageLastBottom = bottom;
        previousWasStrip = false;
        if (appliedMargins.get(child) !== desiredMargin) {
          appliedMargins.set(child, desiredMargin);
          touched.add(child);
          child.style.marginTop = desiredMargin > 0 ? `${desiredMargin}px` : "";
        }
      }

      const existing = Array.from(overlay.children);
      for (let i = 0; i < lines.length; i += 1) {
        const line = (existing[i] as HTMLElement | undefined) ?? document.createElement("div");
        if (!line.isConnected) {
          line.className = styles.pageBoundary;
          overlay.appendChild(line);
        }
        line.style.top = `${lines[i].center - lines[i].height / 2}px`;
        line.style.height = `${lines[i].height}px`;
      }
      for (let i = lines.length; i < existing.length; i += 1) existing[i].remove();

      const pageCount = stripCount + lines.length + 1;
      if (pageCount !== lastPageCountRef.current) {
        lastPageCountRef.current = pageCount;
        onPageCountChange?.(pageCount);
      }
    };

    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(render);
    };

    const unregisterUpdate = editor.registerUpdateListener(schedule);
    const unregisterRoot = editor.registerRootListener((rootEl) => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (rootEl && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(rootEl);
      }
      schedule();
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver?.disconnect();
      unregisterUpdate();
      unregisterRoot();
      // Only clean up inline margins while the editor root is still in the
      // document. Resetting styles after React has begun tearing the editor
      // down fires the table plugin's DOM MutationObserver against a stale
      // editor state, which throws "Expected to find TableElement in DOM".
      const rootEl = editor.getRootElement();
      if (rootEl && rootEl.isConnected) {
        for (const el of touched) el.style.marginTop = "";
      }
    };
  }, [editor, format, zoom, marginY, onPageCountChange]);

  return null;
}
