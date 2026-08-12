import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $addUpdateTag, $createTextNode, $getRoot, SKIP_DOM_SELECTION_TAG } from "lexical";
import type { TextNode } from "lexical";
import { $createSearchHighlightNode, $isSearchHighlightNode } from "../nodes/SearchHighlightNode";
import styles from "../DocumentEditor.module.css";

export interface SearchPluginProps {
  query?: string;
  activeIndex?: number;
  onResultCount?: (count: number) => void;
}

/**
 * Live search highlighting.
 *
 * Re-runs whenever the query or active match index changes: it first unwraps
 * every existing SearchHighlightNode back to plain text, then walks all text
 * nodes, splits each match out and wraps it in a SearchHighlightNode. The
 * match count is reported to the host, and after commit the active match is
 * highlighted with a distinct style and scrolled into view.
 */
export function SearchPlugin({ query = "", activeIndex = 0, onResultCount }: SearchPluginProps) {
  const [editor] = useLexicalComposerContext();
  const countRef = useRef(0);

  useEffect(() => {
    const q = query.trim().toLowerCase();

    editor.update(() => {
      /* Search is a background pass: don't let Lexical restore the DOM
         selection or steal focus from the search input. */
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      const root = $getRoot();
      const nodes = root.getAllTextNodes();
      for (const node of nodes) {
        if ($isSearchHighlightNode(node)) {
          const plain = $createTextNode(node.getTextContent());
          plain.setFormat(node.getFormat());
          plain.setStyle(node.getStyle());
          node.replace(plain);
        }
      }

      if (!q) {
        countRef.current = 0;
        return;
      }

      let count = 0;
      for (const node of root.getAllTextNodes()) {
        count += wrapMatches(node, q, query.length);
      }
      countRef.current = count;
    });

    onResultCount?.(countRef.current);

    requestAnimationFrame(() => {
      const rootEl = editor.getRootElement();
      if (!rootEl || !q) return;
      const marks = Array.from(rootEl.querySelectorAll<HTMLElement>(`.${styles.searchHighlight}`));
      const total = countRef.current;
      const idx = total === 0 ? 0 : ((activeIndex % total) + total) % total;
      marks.forEach((el, i) => el.classList.toggle(styles.searchHighlightActive, i === idx));
      const activeEl = marks[idx];
      if (activeEl) {
        activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }, [editor, query, activeIndex, onResultCount]);

  return null;
}

function wrapMatches(node: TextNode, lowerQuery: string, queryLen: number): number {
  let count = 0;
  let current: TextNode | null = node;
  while (current) {
    const text = current.getTextContent();
    const idx = text.toLowerCase().indexOf(lowerQuery);
    if (idx === -1) break;

    const parts: TextNode[] = current.splitText(idx, idx + queryLen);
    const matchNode: TextNode = idx === 0 ? parts[0] : parts[1];
    const afterNode: TextNode | null = parts[parts.length - 1] !== matchNode ? parts[parts.length - 1] : null;

    const highlight = $createSearchHighlightNode(matchNode.getTextContent());
    highlight.setFormat(matchNode.getFormat());
    highlight.setStyle(matchNode.getStyle());
    matchNode.replace(highlight);

    count += 1;
    current = afterNode;
  }
  return count;
}
