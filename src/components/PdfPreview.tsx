import { useEffect, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";
import { toHtml } from "../export/LexicalToHtml";
import { PaginationService, buildPrintCss, themeVariables } from "../export/PaginationService";
import { scaleHtmlFontSizes } from "../export/fontScale";
import { codeThemeCss, resolveDocumentMode } from "../export/exportTheme";
import { highlightBodyCode } from "../components/ui/DocumentEditor/exporters/epubHighlight";
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

  /** Scale the rendered pages down (never up) so they fit the preview width;
   *  the preview scrolls vertically only. Pages are laid out by Paged.js at
   *  their physical @page size (~794 px for A4), which can overflow a narrow
   *  preview pane. Chromium's `zoom` reflows the page and its content
   *  proportionally. */
  const fitPagesToWidth = (container: HTMLElement) => {
    const pages = Array.from(container.querySelectorAll<HTMLElement>(".pagedjs_page"));
    if (pages.length === 0) return;
    for (const page of pages) {
      page.style.removeProperty("zoom");
    }
    const naturalWidth = pages[0].offsetWidth;
    if (naturalWidth <= 0) return;
    const available = Math.max(0, container.clientWidth - 32);
    const scale = Math.min(1, available / naturalWidth);
    if (scale < 1) {
      for (const page of pages) {
        page.style.setProperty("zoom", String(scale));
      }
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => fitPagesToWidth(container));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
          const bodyHtml = highlightBodyCode(
            scaleHtmlFontSizes(toHtml(editor, { chapterBreaks: options.chapterBreaks }), options.fontSizeScalePct),
          );
          const result = await service.paginate(
            bodyHtml,
            [
              printCss,
              themeVariables(options),
              buildPrintCss(options),
              codeThemeCss(
                options.codeTheme,
                resolveDocumentMode(options.template, options.backgroundColor),
              ),
            ],
            container,
          );
          if (cancelled) {
            service.dispose();
            return;
          }
          // Inline the paper/ink colours on the rendered page elements so the
          // theme always shows in the preview, independent of how Paged.js
          // re-emits the stylesheets into the document head.
          if (options.backgroundColor) {
            for (const page of result.pages) {
              page.style.setProperty("background-color", options.backgroundColor);
            }
          }
          if (options.textColor) {
            for (const page of result.pages) {
              page.style.setProperty("color", options.textColor);
            }
          }
          onPageCountChange?.(result.pageCount);
          fitPagesToWidth(container);
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