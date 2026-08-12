import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import type { PageFormat } from "../constants";

export interface PaginationPluginProps {
  /** Accepted for API compatibility — pagination is CSS-driven now. */
  format?: PageFormat;
  /** Accepted for API compatibility — pagination is CSS-driven now. */
  zoom?: number;
  onWordCountChange?: (count: number) => void;
}

const STATS_DEBOUNCE_MS = 150;

/**
 * Document statistics for the paged editor.
 *
 * Reports the word count on a short debounce so the host stats bar does not
 * churn mid-keystroke. Page count and the PDF page-break lines are handled by
 * PageBoundaryPlugin.
 */
export function PaginationPlugin({ onWordCountChange }: PaginationPluginProps) {
  const [editor] = useLexicalComposerContext();
  const lastWordsRef = useRef<number>(-1);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const collect = () => {
      timerRef.current = null;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const words = root
          .getTextContent()
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;

        if (words !== lastWordsRef.current) {
          lastWordsRef.current = words;
          onWordCountChange?.(words);
        }
      });
    };

    const schedule = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(collect, STATS_DEBOUNCE_MS);
    };

    const unregisterUpdate = editor.registerUpdateListener(schedule);
    schedule();

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      unregisterUpdate();
    };
  }, [editor, onWordCountChange]);

  return null;
}
