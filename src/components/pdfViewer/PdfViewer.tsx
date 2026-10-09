import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, Ref } from "react";
import { ChevronLeft, ChevronRight, Crop, FileWarning, Loader2, Maximize2, Minimize2, Palette, ScanText, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { AnnotationLayer, TextLayer } from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from "pdfjs-dist";
import type { PDFLinkService } from "pdfjs-dist/types/web/pdf_link_service";
import { OcrPanel } from "./OcrPanel";
import { PdfScanRegionOverlay } from "./PdfScanRegionOverlay";
import { AiSelectionBubble } from "../AiSelectionBubble/AiSelectionBubble";
import { useToast } from "../ui/Toast/ToastContext";
import { annotateRegions, extractPdfRegions } from "../../features/reading/translation/pdfRegions";
import type { PdfRegionSnapshot } from "../../features/reading/translation/pdfRegions";
import {
  isWholePageScanRegion,
  scanRegionBox,
  scanRegionTransform,
  scanViewportScale,
} from "../../features/reading/translation/pdfScan";
import type { PdfScanRegion } from "../../features/reading/translation/pdfScan";
import type { PdfRegionBox } from "../../features/reading/translation/pdfRegions";
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
  /** PNG data URL of a page rendered offscreen at the scan resolution, cut to
   *  `region` when given. Null when the document or page is unavailable. */
  getPageImage(page: number, region?: PdfScanRegion | null): Promise<string | null>;
  /** Clean + AI-annotated (red numbered section boxes) renders of a page
   *  with the locally detected sections. Null when unavailable; regions may be
   *  empty when detection fails — callers fall back to `getPageImage`. */
  getRegionPageImage(
    page: number,
    region?: PdfScanRegion | null,
  ): Promise<PdfRegionSnapshot | null>;
  /** Jumps to a page (clamped to the document bounds). */
  goToPage(page: number): void;
  /** Total page count of the loaded document (0 before it loads). */
  getPageCount(): number;
  /** Opens the scan-region trim overlay. No-op without `onScanRegionChange`. */
  startScanRegionSelection(): void;
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
  /** When provided, the extract panel offers an "AI vision" mode: the page
   *  image is handed to the host, which sends it to the AI and returns the
   *  extracted Markdown (already inserted into the editor). No language
   *  selection is offered in this mode — the model detects the language.
   *  The payload carries the user's optional extraction instructions. */
  onAiVision?: (payload: { image: string; instruction: string }) => Promise<string>;
  /** When provided, clicking the page shows an "Ask AI" bubble at the cursor;
   *  clicking the bubble hands a PNG of the current page to the host, which
   *  decides between OCR and AI vision. */
  onAskAi?: (payload: { image: string }) => void;
  /** Page area that is scanned (OCR) or sent to AI vision, as page fractions;
   *  null = the whole page. Applies to every capture this viewer hands out. */
  scanRegion?: PdfScanRegion | null;
  /** Stores a trimmed scan region (null = the whole page) and closes the
   *  overlay. Passing it also enables the viewer's "Scan region" button; the
   *  value itself stays owned by the host, which persists it. */
  onScanRegionChange?: (region: PdfScanRegion | null) => void;
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
  onAiVision,
  onAskAi,
  scanRegion = null,
  onScanRegionChange,
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
  const onAiVisionRef = useRef(onAiVision);
  const onPageSnapshotRef = useRef(onPageSnapshot);
  const onPageChangeRef = useRef(onPageChange);
  const readyRef = useRef(false);
  const snapshottedRef = useRef(false);
  /** True once the reader zoomed by hand. Automatic fits (load, fullscreen,
   *  pane resize) yield to it so a deliberate zoom is not overridden. */
  const userZoomedRef = useRef(false);

  const [ocrOpen, setOcrOpen] = useState(false);
  const [extractMode, setExtractMode] = useState<"ocr" | "vision">("ocr");
  const [visionInstruction, setVisionInstruction] = useState("");
  const visionInstructionRef = useRef(visionInstruction);
  const [visionInstructionId, setVisionInstructionId] = useState("");
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["eng"]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [aiSelection, setAiSelection] = useState<{ x: number; y: number } | null>(null);
  /** True while the scan-region trim overlay is open. */
  const [regionEditing, setRegionEditing] = useState(false);
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
  /** Latest scan region and change handler, read through refs because the
   *  imperative handle is built once and an async render must not work from
   *  the values it started with. */
  const scanRegionRef = useRef<PdfScanRegion | null>(scanRegion);
  const onScanRegionChangeRef = useRef(onScanRegionChange);

  useEffect(() => {
    scanRegionRef.current = scanRegion;
  }, [scanRegion]);

  useEffect(() => {
    onScanRegionChangeRef.current = onScanRegionChange;
  }, [onScanRegionChange]);

  /** Renders a page offscreen at the scan resolution, cut to the scan region.
   *  The single entry point behind every capture, so OCR and AI vision see the
   *  same pixels whatever the reader has zoomed to; the region is rendered
   *  rather than cropped afterwards, so the excluded margins are never painted. */
  const renderScanPage = useCallback(
    async (
      page: number,
      regionOverride: PdfScanRegion | null | undefined,
    ): Promise<{
      canvas: HTMLCanvasElement;
      viewport: PageViewport;
      pageProxy: PDFPageProxy;
      box: PdfRegionBox;
    } | null> => {
      const pdf = docRef.current;
      if (!pdf) return null;
      try {
        const pageProxy = await pdf.getPage(page);
        const viewport = pageProxy.getViewport({ scale: scanViewportScale() });
        // An explicit null is a real instruction to scan the whole page, so
        // the fallback must only apply to `undefined`.
        const region = regionOverride === undefined ? scanRegionRef.current : regionOverride;
        const box = scanRegionBox(region, viewport.width, viewport.height);
        const canvas = document.createElement("canvas");
        canvas.width = box.w;
        canvas.height = box.h;
        if (!canvas.getContext("2d")) return null;
        await pageProxy.render({
          canvas,
          viewport,
          transform: scanRegionTransform(box),
        }).promise;
        return { canvas, viewport, pageProxy, box };
      } catch {
        return null;
      }
    },
    [],
  );

  /** The current page at the scan resolution — the shared step for the OCR
   *  panel and click-to-ask. Goes offscreen so neither depends on the current
   *  zoom or the display's pixel ratio. */
  const capturePageForScan = useCallback(async () => {
    const rendered = await renderScanPage(pageNumber, scanRegionRef.current);
    return rendered ? rendered.canvas.toDataURL("image/png") : null;
  }, [renderScanPage, pageNumber]);

  const showOcr = ocrEnabled || Boolean(onOcrText) || Boolean(onAiVision);
  const { state: pdfTheme } = usePdfTheme();
  /** OCR results and failures are reported as notifications; the panel's own
   *  status line is left for live progress ("Recognizing page… 42%"). */
  const toast = useToast();

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
    getPageImage: async (page: number, region?: PdfScanRegion | null) => {
      const rendered = await renderScanPage(page, region);
      return rendered ? rendered.canvas.toDataURL("image/png") : null;
    },
    getRegionPageImage: async (page: number, region?: PdfScanRegion | null) => {
      const rendered = await renderScanPage(page, region);
      if (!rendered) return null;
      const { canvas, viewport, pageProxy, box } = rendered;
      // Detected locally (pdf.js text + image operators) — the model only
      // returns ids, never coordinates. Clipped to the region so excluded
      // margins never become sections, and shifted into the cropped image.
      const regions = await extractPdfRegions(pageProxy, viewport, box).catch(() => []);
      const annotated = annotateRegions(canvas, regions);
      return {
        clean: canvas.toDataURL("image/png"),
        annotated: annotated.toDataURL("image/png"),
        regions,
        width: canvas.width,
        height: canvas.height,
      };
    },
    getPageCount: () => numPages,
    goToPage: (page: number) => {
      const pdf = docRef.current;
      if (!pdf) return;
      setRegionEditing(false);
      setPageNumber(Math.min(Math.max(1, page), pdf.numPages));
    },
    startScanRegionSelection: () => {
      if (!onScanRegionChangeRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        // Nothing to trim on yet (page still painting); clearing the region
        // back to the whole page is always valid.
        onScanRegionChangeRef.current(null);
        return;
      }
      setAiSelection(null);
      setRegionEditing(true);
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
    onAiVisionRef.current = onAiVision;
  }, [onAiVision]);

  useEffect(() => {
    visionInstructionRef.current = visionInstruction;
  }, [visionInstruction]);

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
      setOcrStatus(null);
      toast.success(`"${lang}" model installed.`);
      await refreshModels();
    } catch (err) {
      setOcrStatus(null);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      downloadingRef.current = null;
      setDownloading(null);
      setDownloadProgress(null);
    }
  }, [refreshModels, toast]);

  const handleDelete = useCallback(async (lang: string) => {
    await window.readlynx?.ocr.deleteModel(lang);
    await refreshModels();
    toast.info(`"${lang}" model removed.`);
  }, [refreshModels, toast]);

  const handleExtract = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      toast.error("The page is still loading.");
      return;
    }
    if (selectedLangs.length === 0) return;
    extractingRef.current = true;
    setExtracting(true);
    setOcrStatus("Preparing page…");
    try {
      const dataUrl = await capturePageForScan();
      if (!dataUrl) throw new Error("The page is still loading.");
      const result = await window.readlynx?.ocr.recognize({ dataUrl, langs: selectedLangs });
      if (!result) throw new Error("OCR is unavailable.");
      if (result.error) throw new Error(result.error);
      const text = (result.text ?? "").trim();
      if (!text) {
        setOcrStatus(null);
        toast.error("No text detected on this page.");
      } else {
        onOcrTextRef.current?.(text);
        setOcrStatus(null);
        toast.success(`${text.length.toLocaleString()} characters extracted and added to the editor.`);
        setOcrOpen(false);
      }
    } catch (err) {
      setOcrStatus(null);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      extractingRef.current = false;
      setExtracting(false);
    }
  }, [selectedLangs, toast, capturePageForScan]);

  /** AI vision extraction: hands the rendered page to the host's AI call
   *  and reports the outcome. The host inserts the returned Markdown into
   *  the editor itself; this handler only drives the panel's busy state and
   *  the notification that reports the result. */
  const handleVisionExtract = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      toast.error("The page is still loading.");
      return;
    }
    const onAiVision = onAiVisionRef.current;
    if (!onAiVision) return;
    extractingRef.current = true;
    setExtracting(true);
    setOcrStatus("Sending the page to AI vision…");
    try {
      const dataUrl = await capturePageForScan();
      if (!dataUrl) throw new Error("The page is still loading.");
      const markdown = await onAiVision({
        image: dataUrl,
        instruction: visionInstructionRef.current,
      });
      const trimmed = (markdown ?? "").trim();
      if (!trimmed) {
        setOcrStatus(null);
        toast.error("The AI returned no text for this page.");
      } else {
        setOcrStatus(null);
        toast.success(`${trimmed.length.toLocaleString()} characters extracted and added to the editor.`);
        setOcrOpen(false);
      }
    } catch (err) {
      setOcrStatus(null);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      extractingRef.current = false;
      setExtracting(false);
    }
  }, [toast, capturePageForScan]);

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
   *  click hands a PNG of the current page to the host, which picks
   *  OCR or AI vision from its top setting. */
  const handlePageClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !onAskAi) return;
      if (regionEditing) return;
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
    [onAskAi, regionEditing],
  );

  /** Hands a PNG of the current page to the host, which decides between OCR
   *  (recognized text seeded into the chat) and AI vision (the page image) from
   *  its top setting. Shared by the click bubble and the right-click shortcut.
   *  Rendered at the scan resolution and cut to the scan region, so what the
   *  user asks about is what the translation pipeline would have read. */
  const askAboutPage = useCallback(() => {
    void capturePageForScan()
      .then((image) => {
        if (image) onAskAi?.({ image });
      })
      .catch(() => {
        // The page could not be re-rendered; the chat panel stays closed.
      });
  }, [onAskAi, capturePageForScan]);

  /** Right-clicking the page with no text selection asks the AI about the
   *  page instead of opening the native menu — the same as the click
   *  bubble, minus the extra step. A text selection is left alone so the
   *  native copy menu still works (same rule as the Markdown/EPUB views). */
  const handlePageContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onAskAi || regionEditing) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      event.preventDefault();
      setAiSelection(null);
      askAboutPage();
    },
    [onAskAi, askAboutPage, regionEditing],
  );

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onPageSnapshotRef.current = onPageSnapshot;
  }, [onPageSnapshot]);

  /** Fits the page to the scroll area. Recomputed whenever the area resizes,
   *  so entering (and leaving) fullscreen shows the page filling the screen
   *  instead of keeping the size it had in the reading pane. */
  const applyFit = useCallback(
    async (pdf: PDFDocumentProxy) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const pad = 48;
      const availableWidth = Math.max(1, scroll.clientWidth - pad);
      let fitted = availableWidth / viewport.width;
      if (fit && !fitWidth) {
        const availableHeight = Math.max(1, scroll.clientHeight - pad);
        fitted = Math.min(fitted, availableHeight / viewport.height);
      }
      setScale(Math.max(0.1, Math.min(ZOOM_MAX, fitted)));
    },
    [fit, fitWidth],
  );

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
        // A new document starts out in automatic-fit mode again.
        userZoomedRef.current = false;
        setRegionEditing(false);

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
          await applyFit(nextDoc);
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
  }, [filePath, fit, fitWidth, initialPage, applyFit]);

  /** Refits on container resize. Fullscreen flips the viewer from the pane's
   *  box to the whole viewport without remounting it, so the load-time fit
   *  alone would leave a pane-sized page adrift on a large screen. Coalesced
   *  into one fit per frame because the observer fires per resize edge, and
   *  skipped while the reader has zoomed by hand — their zoom wins over an
   *  automatic fit until the document changes. */
  useEffect(() => {
    if (!doc || (!fit && !fitWidth) || userZoomedRef.current) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        void applyFit(doc);
      });
    });
    observer.observe(scroll);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [doc, fit, fitWidth, applyFit]);

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
    // The overlay is anchored to the pixels of the page it was drawn on, so a
    // turn would leave it hovering over unrelated content.
    if (page !== pageNumber) setRegionEditing(false);
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

  // The viewer root is a sibling of the layout spacer, never its parent: the
  // fullscreen overlay is `position: fixed`, so a spacer nested inside it
  // would steal that much height from the overlay's own flex column (leaving
  // the page a couple of inches tall) instead of reserving space in the page
  // it was displaced from. Mirrors EpubViewer / Markdown.
  return (
    <>
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
          onClick={() => {
            userZoomedRef.current = true;
            setScale((current) => Math.max(ZOOM_MIN, +(current - ZOOM_STEP).toFixed(2)));
          }}
          disabled={!doc || scale <= ZOOM_MIN}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.zoomValue}
          onClick={() => {
            userZoomedRef.current = true;
            setScale(1);
          }}
          aria-label={`Zoom ${Math.round(scale * 100)} percent, click to reset`}
          title="Reset zoom to 100%"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => {
            userZoomedRef.current = true;
            setScale((current) => Math.min(ZOOM_MAX, +(current + ZOOM_STEP).toFixed(2)));
          }}
          disabled={!doc || scale >= ZOOM_MAX}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn size={16} strokeWidth={2} aria-hidden="true" />
        </button>
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
        {onScanRegionChange && (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <button
              type="button"
              className={`${styles.toolButton} ${regionEditing || !isWholePageScanRegion(scanRegion) ? styles.toolButtonActive : ""}`}
              onClick={() => setRegionEditing((open) => !open)}
              disabled={!doc}
              aria-label="Scan region"
              title={
                isWholePageScanRegion(scanRegion)
                  ? "Choose the part of the page that is scanned (OCR) or sent to AI vision"
                  : "A scan region is set — click to change it"
              }
              aria-pressed={regionEditing}
            >
              <Crop size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </>
        )}
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
            onExtract={extractMode === "vision" ? handleVisionExtract : handleExtract}
            extracting={extracting}
            status={ocrStatus}
            mode={extractMode}
            onModeChange={onAiVision ? setExtractMode : undefined}
            instruction={visionInstruction}
            onInstructionChange={onAiVision ? setVisionInstruction : undefined}
            instructionId={onAiVision ? visionInstructionId : undefined}
            onInstructionIdChange={onAiVision ? setVisionInstructionId : undefined}
            onClose={() => setOcrOpen(false)}
          />
        )}
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
            onContextMenu={handlePageContextMenu}
          >
            <canvas ref={canvasRef} className={`${styles.canvas} pdf-canvas`} onClick={handlePageClick} />
            <div className="pdf-canvas-tint" aria-hidden="true" />
            <div ref={textLayerRef} className="pdf-text-layer textLayer" />
            <div ref={annotationLayerRef} className="pdf-annotation-layer annotationLayer" />
            {/* Reminder of what is scanned, so a region set once is not
                forgotten a hundred pages later. */}
            {!regionEditing && !isWholePageScanRegion(scanRegion) && (
              <div
                className={styles.regionHint}
                aria-hidden="true"
                style={{
                  left: `${(scanRegion?.x ?? 0) * 100}%`,
                  top: `${(scanRegion?.y ?? 0) * 100}%`,
                  width: `${(scanRegion?.w ?? 1) * 100}%`,
                  height: `${(scanRegion?.h ?? 1) * 100}%`,
                }}
              />
            )}
            {regionEditing && onScanRegionChange && (
              <PdfScanRegionOverlay
                region={scanRegion}
                onCommit={(next) => {
                  onScanRegionChange(next);
                  setRegionEditing(false);
                }}
                onClose={() => setRegionEditing(false)}
              />
            )}
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
      {aiSelection && onAskAi && !regionEditing && (
        <AiSelectionBubble
          x={aiSelection.x}
          y={aiSelection.y}
          text=""
          onAsk={() => {
            setAiSelection(null);
            askAboutPage();
          }}
        />
      )}
    </div>
    {isFullscreen && (
      <div className={styles.fullscreenSpacer} style={{ height: spacerHeight }} aria-hidden="true" />
    )}
    </>
  );
}
