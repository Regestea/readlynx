import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode } from "lexical";
import type { ElementNode, NodeKey } from "lexical";
import { $createPageBreakNode, $isPageBreakNode } from "../nodes/PageBreakNode";
import { pageContentHeight, type PageFormat } from "../constants";

export interface PaginationPluginProps {
  format?: PageFormat;
  zoom?: number;
  onPageCountChange?: (count: number) => void;
  onWordCountChange?: (count: number) => void;
}

/**
 * Auto-flow pagination for the editor.
 *
 * On every editor update it measures the rendered height of each top-level
 * block and keeps the runs of blocks between page breaks within a fixed page
 * content height, moving overflowing blocks onto the next page by inserting /
 * removing PageBreakNode decorators.
 *
 * Measurement uses each node's DOM element (`editor.getElementByKey`) and its
 * viewport-relative box relative to the root, so it is independent of the
 * editor's internal DOM structure. Existing page-break strips are temporarily
 * hidden via CSS so they cannot inflate the flow measurement; this guarantees
 * the computation converges to a stable layout.
 */
export function PaginationPlugin({
  format = "a4",
  zoom = 1,
  onPageCountChange,
  onWordCountChange,
}: PaginationPluginProps) {
  const [editor] = useLexicalComposerContext();

  const runningRef = useRef(false);
  const lastPageCountRef = useRef<number>(0);
  const lastWordsRef = useRef<number>(-1);

  useEffect(() => {
    let raf = 0;

    const runPass = () => {
      if (runningRef.current) return;

      const rootEl = editor.getRootElement();
      if (!rootEl) return;

      /* Hide page-break strips so they do not skew the flow measurement. */
      const strips: HTMLElement[] = Array.from(
        rootEl.querySelectorAll<HTMLElement>("[data-page-break]"),
      );
      for (const strip of strips) strip.style.display = "none";

      runningRef.current = true;
      try {
        let words = 0;
        let blockKeys: NodeKey[] = [];
        let currentBreaks: NodeKey[] = [];
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const children = root.getChildren();
          blockKeys = [];
          currentBreaks = [];
          for (const child of children) {
            if ($isPageBreakNode(child)) continue;
            blockKeys.push(child.getKey());
          }
          for (let i = 0; i < children.length - 1; i += 1) {
            if ($isPageBreakNode(children[i])) {
              currentBreaks.push(children[i + 1].getKey());
            }
          }
          words = root
            .getTextContent()
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;
        });

        /* ---- Measure each block's flow position (layout px, zoom-scaled) ---- */
        const rootRect = rootEl.getBoundingClientRect();
        const tops: number[] = [];
        const heights: number[] = [];
        const margins: number[] = [];
        const topMargins: number[] = [];
        for (const key of blockKeys) {
          const el = editor.getElementByKey(key);
          if (!el) {
            tops.push(-1);
            heights.push(0);
            margins.push(0);
            topMargins.push(0);
            continue;
          }
          const rect = el.getBoundingClientRect();
          tops.push(rect.top - rootRect.top);
          heights.push(rect.height);
          const style = getComputedStyle(el);
          margins.push((parseFloat(style.marginBottom) || 0) * zoom);
          topMargins.push((parseFloat(style.marginTop) || 0) * zoom);
        }

        /* ---- Determine desired page breaks + per-page fill heights ---- */
        const limit = pageContentHeight(format) * zoom;
        const desiredBreaks = new Set<NodeKey>();
        const fills: number[] = [];
        let lastFill = 0;
        let startIdx = 0;
        while (startIdx < blockKeys.length) {
          if (tops[startIdx] < 0) {
            startIdx += 1;
            continue;
          }
          const firstTop = tops[startIdx];
          let endIdx = startIdx + 1;
          while (endIdx < blockKeys.length) {
            if (tops[endIdx] < 0) {
              endIdx += 1;
              continue;
            }
            if (
              topMargins[startIdx] +
                (tops[endIdx] - firstTop) +
                heights[endIdx] +
                margins[endIdx] >
              limit
            )
              break;
            endIdx += 1;
          }
          if (endIdx >= blockKeys.length) {
            let lastValid = endIdx - 1;
            while (lastValid >= startIdx && tops[lastValid] < 0) lastValid -= 1;
            const contentHeight =
              lastValid >= startIdx
                ? topMargins[startIdx] + tops[lastValid] - firstTop + heights[lastValid] + margins[lastValid]
                : 0;
            lastFill = Math.max(0, limit - contentHeight);
            break;
          }
          desiredBreaks.add(blockKeys[endIdx]);
          let lastValid = endIdx - 1;
          while (lastValid >= startIdx && tops[lastValid] < 0) lastValid -= 1;
          const contentHeight =
            lastValid >= startIdx
              ? topMargins[startIdx] + tops[lastValid] - firstTop + heights[lastValid] + margins[lastValid]
              : 0;
          fills.push(Math.max(0, limit - contentHeight));
          startIdx = endIdx;
        }

        /* Keep every page full-height: last page gets a padded bottom. */
        rootEl.style.setProperty("--page-last-fill", `${lastFill / zoom}px`);

        /* ---- Apply only when the page breaks actually moved ---- */
        const currentSignature = [...currentBreaks].sort().join("|");
        const desiredSignature = [...desiredBreaks].sort().join("|");
        if (desiredSignature !== currentSignature) {
          editor.update(() => {
            const root = $getRoot();
            for (const child of root.getChildren()) {
              if ($isPageBreakNode(child)) child.remove();
            }
            const nodeByKey = new Map<NodeKey, ElementNode>();
            for (const child of root.getChildren()) {
              if ($isElementNode(child)) nodeByKey.set(child.getKey(), child);
            }
            let breakIndex = 0;
            for (const key of desiredBreaks) {
              const node = nodeByKey.get(key);
              if (node) {
                node.insertBefore($createPageBreakNode(breakIndex + 2, fills[breakIndex] / zoom));
                breakIndex += 1;
              }
            }
          });
        }

        /* ---- Report stats when they change ---- */
        const pageCount = desiredBreaks.size + 1;
        if (pageCount !== lastPageCountRef.current) {
          lastPageCountRef.current = pageCount;
          onPageCountChange?.(pageCount);
        }
        if (words !== lastWordsRef.current) {
          lastWordsRef.current = words;
          onWordCountChange?.(words);
        }
      } finally {
        runningRef.current = false;
        for (const strip of strips) strip.style.display = "";
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(runPass);
    };

    const unregisterUpdate = editor.registerUpdateListener(schedule);
    const unregisterRoot = editor.registerRootListener((rootElement) => {
      if (rootElement) schedule();
    });

    schedule();

    return () => {
      cancelAnimationFrame(raf);
      unregisterUpdate();
      unregisterRoot();
      try {
        editor.update(() => {
          const root = $getRoot();
          for (const child of root.getChildren()) {
            if ($isPageBreakNode(child)) child.remove();
          }
        });
      } catch {
        /* editor already torn down */
      }
    };
  }, [editor, format, zoom, onPageCountChange, onWordCountChange]);

  return null;
}
