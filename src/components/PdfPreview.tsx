import { useEffect, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";
import { toHtml } from "../export/LexicalToHtml";
import { PaginationService, buildPrintCss, themeVariables } from "../export/PaginationService";
import type { PdfExportOptions } from "../export/types";
import printCss from "../export/PrintStyles.css?raw";
import styles from "./PdfPreview.module.css";

type PreviewState = "idle" | "rendering" | "ready" | "error";

export interface PdfPreviewProps {
  editor: LexicalEditor;
  options: PdfExportOptions;
  onPageCountChange?: (count: number) => void;
  className?: string;
}

/**
 * Live print preview. Re-paginates the document with Paged.js each time the
 * options change and renders the resulting physical pages. Pagination is
 * triggered explicitly (opening the preview / editing an option) — never on
 * keystrokes in the editor.
 */
export function PdfPreview({ editor, options, onPageCountChange, className }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentServiceRef = useRef<PaginationService | null>(null);
  const [state, setState] = useState<PreviewState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const service = new PaginationService();
        currentServiceRef.current?.dispose();
        currentServiceRef.current = service;

        container.replaceChildren();
        setState("rendering");
        setError(null);

        try {
          const bodyHtml = toHtml(editor, { chapterBreaks: options.chapterBreaks });
          const result = await service.paginate(
            bodyHtml,
            [printCss, themeVariables(options), buildPrintCss(options)],
            container,
          );
          if (cancelled) {
            service.dispose();
            return;
          }
          onPageCountChange?.(result.pageCount);
          setState("ready");
        } catch (cause) {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setState("error");
          }
          service.dispose();
          if (currentServiceRef.current === service) {
            currentServiceRef.current = null;
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editor, options, onPageCountChange]);

  useEffect(() => {
    return () => {
      currentServiceRef.current?.dispose();
      currentServiceRef.current = null;
    };
  }, []);

  return (
    <div className={`${styles.stage} ${className ?? ""}`} data-preview-state={state}>
      <div
        ref={containerRef}
        className={styles.viewport}
        aria-label="Print preview — pages appear exactly as they will be printed"
      >
        {state === "rendering" && <div className={styles.status}>Paginating…</div>}
        {state === "error" && <div className={styles.error}>Pagination failed: {error}</div>}
      </div>
    </div>
  );
}