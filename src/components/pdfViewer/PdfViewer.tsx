import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, Ref } from "react";
import { ChevronLeft, ChevronRight, FileWarning, Loader2, Maximize2, Minimize2, Palette, ScanText, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { AnnotationLayer, TextLayer } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { PDFLinkService } from "pdfjs-dist/types/web/pdf_link_service";
import { OcrPanel } from "./OcrPanel";
import { AiSelectionBubble } from "../AiSelectionBubble/AiSelectionBubble";
import { usePdfTheme } from "./theme/PdfThemeContext";
import { applyPdfTheme } from "./theme/PdfThemeManager";
import { PdfThemeProvider } from "./theme/PdfThemeProvider";
import { PdfThemeSettings } from "./theme/PdfThemeSettings";
import styles from "./PdfViewer.module.css";
import "./theme/pdf-theme.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

/** Imperative handle for hosts that need to peek at the rendered page (e.g.
 *  reading-mode translation captures the canvas for OCR / AI vision). */
export interface PdfViewerHandle {
  /** PNG data URL of the currently rendered page, or null while unavailable. */
  getCurrentPageImage(): string | null;
  /** PNG data URL of an arbitrary page rendered offscreen at a fixed
   *  resolution, or null when the document or page is unavailable. */
  getPageImage(page: number): Promise<string | null>;
  /** Jumps to a page (clamped to the document bounds). */
  goToPage(page: number): void;
  /** Total page count of the loaded document (0 before it loads). */
  getPageCount(): number;
}

interface PdfViewerProps {
  filePath: string;
  className?: string;
  ariaLabel?: string;
  /** When true, fills the parent instead of using a fixed height. */
  fill?: boolean;
  /** Hide the controls toolbar (used for embedded first-page previews). */
  toolbar?: boolean;
  /** Scale the first page to fit the container (whole page visible). */
  fit?: boolean;
  /** Scale the first page to fit the container width (source-pane reading). */
  fitWidth?: boolean;
  /** Called once the first page has been painted (the page the document
   *  resumes at when `initialPage` is set). */
  onReady?: () => void;
  /** Called whenever the displayed page changes (after load and on turn). */
  onPageChange?: (page: number) => void;
  /** When set, renders page 1 offscreen at high resolution and reports the
   *  PNG data URL (used for cover capture — quality independent of the
   *  on-screen size). */
  onPageSnapshot?: (dataUrl: string | null) => void;
  /** When true, show the OCR toolbar button even without an `onOcrText` handler. */
  ocrEnabled?: boolean;
  /** Called with the text recognized from the current page. */
  onOcrText?: (text: string) => void;
  /** When provided, clicking the page shows an "Ask AI" bubble at the cursor;
   *  clicking the bubble hands a PNG of the current page to the host, which
   *  decides between OCR and AI vision. */
  onAskAi?: (payload: { image: string }) => void;
  /** Book id whose `ReaderSettings` row ("pdf" viewer) holds the reading
   *  theme. Omit in previews to keep the global localStorage theme. */
  themeBookId?: string;
  /** Page to display once the document loads — used to resume reading where
   *  the user left off. */
  initialPage?: number;
}

export function PdfViewer(props: PdfViewerProps & { ref?: Ref<PdfViewerHandle> }) {
  return (
    <PdfThemeProvider bookId={props.themeBookId}>
      <PdfViewerInner {...props} />
    </PdfThemeProvider>
  );
}

function PdfViewerInner({
  filePath,
  className = "",
  ariaLabel = "PDF document",
  fill = false,
  toolbar = true,
  fit = false,
  fitWidth = false,
  onReady,
  onPageChange,
  onPageSnapshot,
  ocrEnabled = false,
  onOcrText,
  onAskAi,
  initialPage,
  ref,
}: PdfViewerProps & { ref?: Ref<PdfViewerHandle> }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const loadTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const renderGenerationRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const onOcrTextRef = useRef(onOcrText);
  const onPageSnapshotRef = useRef(onPageSnapshot);
  const onPageChangeRef = useRef(onPageChange);
  const readyRef = useRef(false);
  const snapshottedRef = useRef(false);

  const [ocrOpen, setOcrOpen] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["eng"]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [aiSelection, setAiSelection] = useState<{ x: number; y: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const [themeOpen, setThemeOpen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const downloadingRef = useRef<string | null>(null);
  const extractingRef = useRef(false);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const annotationLayerTaskRef = useRef<AnnotationLayer | null>(null);
  const themeWrapRef = useRef<HTMLSpanElement>(null);

  const showOcr = ocrEnabled || Boolean(onOcrText);
  const { state: pdfTheme } = usePdfTheme();

  /** The subset of pdf.js's PDFLinkService the annotation layer touches. This
   *  viewer renders pages standalone (no document-outline navigation), so
   *  links render and follow the theme but do not jump anywhere. */
  const pdfLinkService = useMemo<PDFLinkService>(
    () =>
      ({
        externalLinkTarget: 2,
        getDestinationHash: () => "",
        getAnchorUrl: (anchor: string) => anchor,
        setHash: () => {},
        navigateTo: () => {},
        goToDestination: () => Promise.resolve(),
        executeSetOCGState: () => Promise.resolve(),
        addLinkAttributes: (link: HTMLAnchorElement, url: string, newWindow = false) => {
          link.href = url;
          if (newWindow) link.target = "_blank";
        },
      }) as unknown as PDFLinkService,
    [],
  );

  useImperativeHandle(ref, () => ({
    getCurrentPageImage: () => canvasRef.current?.toDataURL("image/png") ?? null,
    getPageImage: async (page: number) => {
      const pdf = docRef.current;
      if (!pdf) return null;
      try {
        const pageProxy = await pdf.getPage(page);
        const base = pageProxy.getViewport({ scale: 1 });
        // Fixed quality target (≈ the cover snapshot resolution), so range
        // translation reads well even when the on-screen page is tiny.
        const snapshotScale = 1240 / base.width;
        const viewport = pageProxy.getViewport({ scale: snapshotScale });
        const snap = document.createElement("canvas");
        snap.width = Math.floor(viewport.width);
        snap.height = Math.floor(viewport.height);
        const snapCtx = snap.getContext("2d");
        if (!snapCtx) return null;
        await pageProxy.render({ canvas: snap, viewport }).promise;
        return snap.toDataURL("image/png");
      } catch {
        return null;
      }
    },
    getPageCount: () => numPages,
    goToPage: (page: number) => {
      const pdf = docRef.current;
      if (!pdf) return;
      setPageNumber(Math.min(Math.max(1, page), pdf.numPages));
    },
  }));

  const refreshModels = useCallback(async () => {
    const info = await window.readlynx?.ocr.getInfo();
    if (info) setInstalled(info.installed);
  }, []);

  useEffect(() => {
    onOcrTextRef.current = onOcrText;
  }, [onOcrText]);

  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  /** Reports page changes (after load and on turn) so hosts can refresh
   *  per-page state, e.g. the reading-mode translation cache. */
  useEffect(() => {
    if (!doc) return;
    onPageChangeRef.current?.(pageNumber);
  }, [doc, pageNumber]);

  useEffect(() => {
    if (!showOcr) return;
    const unsubscribeDownload =
      window.readlynx?.ocr.onDownloadProgress(({ lang, received, total }) => {
        if (downloadingRef.current !== lang) return;
        const ratio = total > 0 ? received / total : 0;
        setDownloadProgress(ratio);
        setOcrStatus(`Downloading ${lang} model… ${Math.round(ratio * 100)}%`);
      });
    const unsubscribeRecognize =
      window.readlynx?.ocr.onRecognizeProgress(({ progress }) => {
        if (extractingRef.current) {
          setOcrStatus(`Recognizing page… ${Math.round(progress * 100)}%`);
        }
      });
    return () => {
      unsubscribeDownload?.();
      unsubscribeRecognize?.();
    };
  }, [showOcr]);

  /** Close the panel when clicking outside of it. */
  useEffect(() => {
    if (!ocrOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setOcrOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [ocrOpen]);

  /** Close the theme panel when clicking outside of it. */
  useEffect(() => {
    if (!themeOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (themeWrapRef.current && !themeWrapRef.current.contains(event.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [themeOpen]);

  /** Applies the reading theme to the viewer root. Purely a CSS custom
   *  property swap — no pdfjs-dist re-render happens on theme changes, so
   *  switching themes stays instant even on multi-hundred-page documents. */
  useEffect(() => {
    const root = viewerRef.current;
    if (!root) return;
    applyPdfTheme(root, pdfTheme);
  }, [pdfTheme]);

  const handleDownload = useCallback(async (lang: string) => {
    if (downloadingRef.current) return;
    downloadingRef.current = lang;
    setDownloading(lang);
    setDownloadProgress(0);
    setOcrStatus(`Downloading ${lang} model…`);
    try {
      const result = await window.readlynx?.ocr.downloadModel(lang);
      if (!result || !result.ok) {
        throw new Error(result?.error ?? `Could not download the ${lang} model.`);
      }
      setOcrStatus(`"${lang}" model installed.`);
      await refreshModels();
    } catch (err) {
      setOcrStatus(err instanceof Error ? err.message : String(err));
    } finally {
      downloadingRef.current = null;
      setDownloading(null);
      setDownloadProgress(null);
    }
  }, [refreshModels]);

  const handleDelete = useCallback(async (lang: string) => {
    await window.readlynx?.ocr.deleteModel(lang);
    await refreshModels();
    setOcrStatus(`"${lang}" model removed.`);
  }, [refreshModels]);

  const handleExtract = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setOcrStatus("The page is still loading.");
      return;
    }
    if (selectedLangs.length === 0) return;
    extractingRef.current = true;
    setExtracting(true);
    setOcrStatus("Preparing page…");
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const result = await window.readlynx?.ocr.recognize({ dataUrl, langs: selectedLangs });
      if (!result) throw new Error("OCR is unavailable.");
      if (result.error) throw new Error(result.error);
      const text = (result.text ?? "").trim();
      if (!text) {
        setOcrStatus("No text detected on this page.");
      } else {
        onOcrTextRef.current?.(text);
        setOcrStatus(`${text.length.toLocaleString()} characters extracted and added to the editor.`);
        setOcrOpen(false);
      }
    } catch (err) {
      setOcrStatus(err instanceof Error ? err.message : String(err));
    } finally {
      extractingRef.current = false;
      setExtracting(false);
    }
  }, [selectedLangs]);

  const handleOcrToggle = useCallback(() => {
    setOcrOpen((open) => !open);
    void refreshModels();
  }, [refreshModels]);

  /** Exits the in-page fullscreen overlay with Escape. */
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const toggleFullscreen = () => {
    if (!isFullscreen && viewerRef.current) {
      setSpacerHeight(viewerRef.current.offsetHeight);
    }
    setIsFullscreen((prev) => !prev);
  };

  /** Click-to-ask: floats the "Ask AI" bubble at the cursor. The bubble's
   *  click hands a PNG of the whole current page to the host, which picks
   *  OCR or AI vision from its top setting. */
  const handlePageClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !onAskAi) return;
      const rect = canvas.getBoundingClientRect();
      const relX = event.clientX - rect.left;
      const relY = event.clientY - rect.top;
      const bubbleWidth = 40;
      const x =
        relX + rect.left + bubbleWidth + 12 <= window.innerWidth - 8
          ? relX + rect.left + 12
          : Math.max(8, relX + rect.left - bubbleWidth - 12);
      const y = Math.max(8, Math.min(relY + rect.top - 52, window.innerHeight - bubbleWidth));
      setAiSelection({ x, y });
    },
    [onAskAi],
  );

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onPageSnapshotRef.current = onPageSnapshot;
  }, [onPageSnapshot]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setDoc(null);
        docRef.current = null;
        setError(null);
        setPageNumber(1);
        setNumPages(0);
        setRendering(true);
        snapshottedRef.current = false;
        readyRef.current = false;

        const data = await window.readlynx?.readFileBytes(filePath);
        if (!data) {
          throw new Error(`Could not read "${filePath}". The file may not exist.`);
        }
        if (cancelled) return;

        const loadTask = pdfjsLib.getDocument({ data });
        loadTaskRef.current = loadTask;
        const nextDoc = await loadTask.promise;
        if (cancelled) {
          void loadTask.destroy();
          return;
        }

        setDoc(nextDoc);
        docRef.current = nextDoc;
        setNumPages(nextDoc.numPages);
        // Resume reading where the user left off: jump to the saved page.
        if (initialPage !== undefined && initialPage > 1) {
          setPageNumber(Math.min(Math.max(1, initialPage), nextDoc.numPages));
        }
        if (fit || fitWidth) {
          const firstPage = await nextDoc.getPage(1);
          const viewport = firstPage.getViewport({ scale: 1 });
          const scroll = scrollRef.current;
          if (scroll) {
            const pad = 48;
            const availableWidth = Math.max(1, scroll.clientWidth - pad);
            let fitted = availableWidth / viewport.width;
            if (fit && !fitWidth) {
              const availableHeight = Math.max(1, scroll.clientHeight - pad);
              fitted = Math.min(fitted, availableHeight / viewport.height);
            }
            setScale(Math.max(0.1, Math.min(ZOOM_MAX, fitted)));
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      docRef.current = null;
      renderTaskRef.current?.cancel();
      textLayerTaskRef.current?.cancel();
      annotationLayerTaskRef.current?.destroy();
      void loadTaskRef.current?.destroy();
      loadTaskRef.current = null;
    };
  }, [filePath, fit, fitWidth, initialPage]);

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, page: number, s: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const generation = ++renderGenerationRef.current;
    const previousTask = renderTaskRef.current;
    renderTaskRef.current = null;
    if (previousTask) {
      previousTask.cancel();
      try {
        await previousTask.promise;
      } catch {
        // Expected: the superseded render was cancelled; the canvas is now free.
      }
    }
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    annotationLayerTaskRef.current?.destroy();
    annotationLayerTaskRef.current = null;
    try {
      const pageProxy: PDFPageProxy = await pdf.getPage(page);
      if (generation !== renderGenerationRef.current) return;
      setRendering(true);
      const viewport = pageProxy.getViewport({ scale: s });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const outputScale = dpr;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const transform: number[] | undefined = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
const task = pageProxy.render({ canvas, viewport, transform });
        renderTaskRef.current = task;
        await task.promise;
        if (!readyRef.current) {
          readyRef.current = true;
          onReadyRef.current?.();
        }
        if (page === 1 && !snapshottedRef.current) {
          snapshottedRef.current = true;
          const report = onPageSnapshotRef.current;
          if (report) {
            try {
              const base = pageProxy.getViewport({ scale: 1 });
              const snapshotScale = 1240 / base.width;
              const snapViewport = pageProxy.getViewport({ scale: snapshotScale });
              const snap = document.createElement("canvas");
              snap.width = Math.floor(snapViewport.width);
              snap.height = Math.floor(snapViewport.height);
              const snapCtx = snap.getContext("2d");
              if (snapCtx) {
                await pageProxy.render({ canvas: snap, viewport: snapViewport }).promise;
                report(snap.toDataURL("image/png"));
              } else {
                report(null);
              }
            } catch (err: unknown) {
              if (err instanceof Error && err.name === "RenderingCancelledException") return;
              report(null);
            }
          }
        }
        const textContainer = textLayerRef.current;
        if (textContainer) {
          textContainer.textContent = "";
          const textLayer = new TextLayer({
            textContentSource: pageProxy.streamTextContent(),
            container: textContainer,
            viewport,
          });
          textLayerTaskRef.current = textLayer;
          void textLayer.render().catch(() => {
            // Cosmetic overlay: a failed text layer must not break the page.
          });
        }
        const annotationDiv = annotationLayerRef.current;
        if (annotationDiv) {
          try {
            annotationDiv.textContent = "";
            const annotations = await pageProxy.getAnnotations();
            const annotationLayer = new AnnotationLayer({
              div: annotationDiv,
              page: pageProxy,
              viewport,
              linkService: pdfLinkService,
              accessibilityManager: undefined,
              annotationCanvasMap: undefined,
              annotationEditorUIManager: undefined,
              structTreeLayer: undefined,
              commentManager: undefined,
              annotationStorage: undefined,
            });
            annotationLayerTaskRef.current = annotationLayer;
            await annotationLayer.render({
              annotations,
              viewport,
              div: annotationDiv,
              page: pageProxy,
              linkService: pdfLinkService,
              renderForms: false,
            });
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "RenderingCancelledException") return;
            // Annotation rendering is decorative — a failure must not fail the page.
          }
        }
      } catch (err: unknown) {
      if (err instanceof Error && err.name === "RenderingCancelledException") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }, [pdfLinkService]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const run = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setAiSelection(null);
      await renderPage(doc, pageNumber, scale);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale, renderPage]);

  const goTo = (page: number) => {
    if (!doc) return;
    setPageNumber(Math.min(Math.max(1, page), numPages));
  };

  const classes = [
    styles.viewer,
    fill ? styles.fill : "",
    isFullscreen ? styles.viewerFullscreen : "",
    "pdf-theme-root",
    className,
  ].filter(Boolean).join(" ");
  const showCanvas = doc && !error;

  return (
    <div ref={viewerRef} className={classes} aria-label={ariaLabel}>
      {toolbar && (
        <div className={`${styles.toolbar} pdf-toolbar`} role="toolbar" aria-label="PDF controls">
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => goTo(pageNumber - 1)}
          disabled={!doc || pageNumber <= 1}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.pageInfo}>
          <input
            type="number"
            className={styles.pageInput}
            min={1}
            max={numPages || 1}
            value={pageNumber}
            onChange={(event) => goTo(Number(event.target.value))}
            aria-label="Current page"
            disabled={!doc}
          />
          <span className={styles.pageOf}>/ {numPages}</span>
        </span>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => goTo(pageNumber + 1)}
          disabled={!doc || pageNumber >= numPages}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => setScale((current) => Math.max(ZOOM_MIN, +(current - ZOOM_STEP).toFixed(2)))}
          disabled={!doc || scale <= ZOOM_MIN}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.zoomValue}
          onClick={() => setScale(1)}
          aria-label={`Zoom ${Math.round(scale * 100)} percent, click to reset`}
          title="Reset zoom to 100%"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => setScale((current) => Math.min(ZOOM_MAX, +(current + ZOOM_STEP).toFixed(2)))}
          disabled={!doc || scale >= ZOOM_MAX}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={`${styles.toolButton} ${styles.toolbarEnd} ${isFullscreen ? styles.toolButtonActive : ""}`}
          onClick={toggleFullscreen}
          disabled={!doc}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Maximize2 size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
        {showOcr && (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <button
              type="button"
              className={styles.toolButton}
              onClick={handleOcrToggle}
              aria-label="Extract text with OCR"
              title="Extract text from the current page"
              aria-expanded={ocrOpen}
            >
              <ScanText size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </>
        )}
        {showOcr && (
          <OcrPanel
            open={ocrOpen}
            installed={installed}
            selected={selectedLangs}
            onSelectedChange={setSelectedLangs}
            downloading={downloading}
            downloadProgress={downloadProgress}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onExtract={handleExtract}
            extracting={extracting}
            status={ocrStatus}
            onClose={() => setOcrOpen(false)}
          />
        )}
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.themeWrap} ref={themeWrapRef}>
          <button
            type="button"
            className={`${styles.toolButton} ${themeOpen ? styles.toolButtonActive : ""}`}
            onClick={() => setThemeOpen((open) => !open)}
            aria-label="Reading theme"
            title="Reading theme"
            aria-haspopup="true"
            aria-expanded={themeOpen}
          >
            <Palette size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <PdfThemeSettings open={themeOpen} onClose={() => setThemeOpen(false)} />
        </span>
      </div>
      )}

      <div
        className={styles.scroll}
        ref={scrollRef}
        style={{ background: "var(--pdf-background-color)" }}
        onClick={(event) => {
          if (event.target !== canvasRef.current) setAiSelection(null);
        }}
      >
        {error ? (
          <div className={styles.error} role="alert">
            <FileWarning size={28} strokeWidth={1.8} aria-hidden="true" />
            <p className={styles.errorText}>{error}</p>
          </div>
        ) : showCanvas ? (
          <div
            className={`${styles.page} pdf-page`}
            style={{ "--scale-factor": String(scale) } as CSSProperties}
          >
            <canvas ref={canvasRef} className={`${styles.canvas} pdf-canvas`} onClick={handlePageClick} />
            <div className="pdf-canvas-tint" aria-hidden="true" />
            <div ref={textLayerRef} className="pdf-text-layer textLayer" />
            <div ref={annotationLayerRef} className="pdf-annotation-layer annotationLayer" />
            {rendering && (
              <div className={styles.renderingOverlay} aria-hidden="true">
                <Loader2 className={styles.spinner} size={20} strokeWidth={2} />
              </div>
            )}
          </div>
        ) : (
          <div className={styles.loading} aria-label="Loading PDF">
            <Loader2 className={styles.spinner} size={24} strokeWidth={2} />
            <span>Loading PDF…</span>
          </div>
        )}
      </div>
      {isFullscreen && (
        <div className={styles.fullscreenSpacer} style={{ height: spacerHeight }} aria-hidden="true" />
      )}
      {aiSelection && onAskAi && (
        <AiSelectionBubble
          x={aiSelection.x}
          y={aiSelection.y}
          text=""
          onAsk={() => {
            const image = canvasRef.current?.toDataURL("image/png") ?? null;
            setAiSelection(null);
            if (image) onAskAi({ image });
          }}
        />
      )}
    </div>
  );
}