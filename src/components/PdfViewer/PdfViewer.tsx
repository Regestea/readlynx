import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning, FolderOpen, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
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
}

export function PdfViewer({ filePath, className = "", ariaLabel = "PDF document" }: PdfViewerProps) {
  const [path, setPath] = useState(filePath);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setDoc(null);
        setError(null);
        setPageNumber(1);
        setNumPages(0);
        setRendering(true);

        const data = await window.readlynx?.readFileBytes(path);
        if (!data) {
          throw new Error(`Could not read "${path}". The file may not exist.`);
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
  }, [path]);

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

  const handlePick = async () => {
    const picked = await window.readlynx?.pickFile({
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    if (picked) setPath(picked);
  };

  const classes = [styles.viewer, className].filter(Boolean).join(" ");
  const showCanvas = doc && !error;

  return (
    <div className={classes} aria-label={ariaLabel}>
      <div className={styles.toolbar} role="toolbar" aria-label="PDF controls">
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void handlePick()}
          aria-label="Open PDF file"
          title="Open PDF file"
        >
          <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
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
      </div>

      <div className={styles.scroll}>
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