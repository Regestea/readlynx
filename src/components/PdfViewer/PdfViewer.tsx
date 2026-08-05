import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning, Loader2, ScanText, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { OcrPanel } from "./OcrPanel";
import styles from "./PdfViewer.module.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

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
  /** Called once the first page has been painted. */
  onReady?: () => void;
  /** When true, show the OCR toolbar button even without an `onOcrText` handler. */
  ocrEnabled?: boolean;
  /** Called with the text recognized from the current page. */
  onOcrText?: (text: string) => void;
}

export function PdfViewer({
  filePath,
  className = "",
  ariaLabel = "PDF document",
  fill = false,
  toolbar = true,
  fit = false,
  fitWidth = false,
  onReady,
  ocrEnabled = false,
  onOcrText,
}: PdfViewerProps) {
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
  const renderTaskRef = useRef<RenderTask | null>(null);
  const onReadyRef = useRef(onReady);
  const onOcrTextRef = useRef(onOcrText);
  const readyRef = useRef(false);

  const [ocrOpen, setOcrOpen] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["eng"]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const downloadingRef = useRef<string | null>(null);
  const extractingRef = useRef(false);

  const showOcr = ocrEnabled || Boolean(onOcrText);

  const refreshModels = useCallback(async () => {
    const info = await window.readlynx?.ocr.getInfo();
    if (info) setInstalled(info.installed);
  }, []);

  useEffect(() => {
    onOcrTextRef.current = onOcrText;
  }, [onOcrText]);

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

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setDoc(null);
        setError(null);
        setPageNumber(1);
        setNumPages(0);
        setRendering(true);

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
        setNumPages(nextDoc.numPages);
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
      renderTaskRef.current?.cancel();
      void loadTaskRef.current?.destroy();
      loadTaskRef.current = null;
    };
  }, [filePath, fit, fitWidth]);

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, page: number, s: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderTaskRef.current?.cancel();
    try {
      const pageProxy: PDFPageProxy = await pdf.getPage(page);
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
        if (page === 1 && !readyRef.current) {
          readyRef.current = true;
          onReadyRef.current?.();
        }
      } catch (err: unknown) {
      if (err instanceof Error && err.name === "RenderingCancelledException") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }, []);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const run = async () => {
      await Promise.resolve();
      if (cancelled) return;
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

  const classes = [styles.viewer, fill ? styles.fill : "", className].filter(Boolean).join(" ");
  const showCanvas = doc && !error;

  return (
    <div className={classes} aria-label={ariaLabel}>
      {toolbar && (
        <div className={styles.toolbar} role="toolbar" aria-label="PDF controls">
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
      </div>
      )}

      <div className={styles.scroll} ref={scrollRef}>
        {error ? (
          <div className={styles.error} role="alert">
            <FileWarning size={28} strokeWidth={1.8} aria-hidden="true" />
            <p className={styles.errorText}>{error}</p>
          </div>
        ) : showCanvas ? (
          <div className={styles.page}>
            <canvas ref={canvasRef} className={styles.canvas} />
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
    </div>
  );
}