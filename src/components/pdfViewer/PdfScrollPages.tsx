import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  Ref,
  RefObject,
} from "react";
import { Loader2 } from "lucide-react";
import { AnnotationLayer, TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { PDFLinkService } from "pdfjs-dist/types/web/pdf_link_service";
import { PdfScanRegionOverlay } from "./PdfScanRegionOverlay";
import { isWholePageScanRegion } from "../../features/reading/translation/pdfScan";
import type { PdfScanRegion } from "../../features/reading/translation/pdfScan";
import styles from "./PdfScrollPages.module.css";

/** Imperative surface PdfViewer drives the scroll layout through: toolbar
 *  jumps land here, and the reading page asks for the scroll ratio when it
 *  persists the reading position. */
export interface PdfScrollPagesHandle {
  /** Scrolls the requested page's top to the top of the viewport. */
  scrollToPage(page: number): void;
  /** Whole-document scroll position as a 0..1 ratio, or null before the
   *  column can scroll. Stored per book, so it survives zoom and resizes. */
  getScrollRatio(): number | null;
  /** The rendered canvas of `page`, or null while that page's slot is
   *  empty (outside the render window). */
  getPageCanvas(page: number): HTMLCanvasElement | null;
}

/** How far beyond the viewport the render window reaches, as a margin around
 *  the scroll root: pages within this band hold a live canvas, everything
 *  else is an exactly-sized placeholder. */
const RENDER_WINDOW_MARGIN = "120% 0px 120% 0px";
/** Scroll activity is reported to the host at most this often, so position
 *  saves (and the Ask-AI bubble dismissal) cost one call per gesture. */
const SCROLL_PING_MS = 300;
/** The "page the reader is mostly looking at" is reported only after the
 *  scroll has been quiet for this long — a fling across fifty pages must not
 *  fire fifty page changes (each one a DB write and a translation-unit swap). */
const PAGE_REPORT_DELAY_MS = 250;

interface PageSize {
  width: number;
  height: number;
}

interface PdfScrollPagesProps {
  doc: PDFDocumentProxy;
  /** pdf.js scale every page renders at (fit baseline × zoom) — the paged
   *  layout's value, so the zoom toolbar works identically in both modes. */
  scale: number;
  linkService: PDFLinkService;
  /** Scan region shown as a dashed reminder on every page; null = whole page. */
  scanRegion: PdfScanRegion | null;
  /** Page hosting the open scan-region trim overlay, or null. */
  regionEditPage: number | null;
  onRegionCommit: (region: PdfScanRegion | null) => void;
  onRegionCancel: () => void;
  /** Page to land on when no saved scroll ratio applies. */
  initialPage: number;
  /** Whole-document 0..1 ratio to restore on the first layout. Read once on
   *  mount; later toggles pass null and anchor to `initialPage` instead. */
  initialScrollRatio: number | null;
  /** The mostly-visible page changed (already debounced to scroll-idle). */
  onMostVisiblePage: (page: number) => void;
  /** Scroll activity ping (throttled): hosts dismiss overlays and schedule
   *  position saves with it. */
  onScrollActivity: () => void;
  onPageClick: (page: number, event: ReactMouseEvent<HTMLDivElement>) => void;
  onPageContextMenu: (page: number, event: ReactMouseEvent<HTMLDivElement>) => void;
  /** A click that did not land on any page (the margins around the column). */
  onBackgroundClick: () => void;
  /** First page bitmap painted — the scroll layout's "ready". */
  onFirstPaint: () => void;
  /** The column has mounted (restore inputs are about to be consumed). */
  onMounted: () => void;
  /** Shared with the host: registered to the real scroll element in both
   *  layouts, so the fit logic measures whichever one is on screen. */
  scrollRef: RefObject<HTMLDivElement | null>;
}

/** The whole document as one continuous, virtualized column.
 *
 *  Every page gets a placeholder slot with its exact rendered size (measured
 *  from the document once), so the scrollbar and the total height are correct
 *  from the first frame no matter how many pages the book has. An
 *  IntersectionObserver promotes the slots near the viewport to real page
 *  renders (canvas + text + annotation layers, each page owning its render
 *  task) and demotes them when they leave the window, cancelling the pending
 *  work — a five-hundred-page book costs a handful of canvases, not five
 *  hundred.
 *
 *  The "current page" of a continuous document is the one sharing the most
 *  area with the viewport. It is reported only after the scroll settles, and
 *  the viewport's offset inside that page (a ratio, like the whole-document
 *  one) is kept as an anchor so zoom and pane resizes reposition without
 *  visibly moving the text. */
export function PdfScrollPages(props: PdfScrollPagesProps & { ref?: Ref<PdfScrollPagesHandle> }) {
  const {
    doc,
    scale,
    linkService,
    scanRegion,
    regionEditPage,
    onRegionCommit,
    onRegionCancel,
    initialPage,
    initialScrollRatio,
    onMostVisiblePage,
    onScrollActivity,
    onPageClick,
    onPageContextMenu,
    onBackgroundClick,
    onFirstPaint,
    onMounted,
    scrollRef,
    ref,
  } = props;

  /** Exact page sizes at scale 1, page 1 first — the placeholder geometry
   *  everything else (offsets, anchors, restore) is derived from. Null while
   *  the document is being measured. */
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  /** Pages currently holding a live render (inside the IO window). */
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set());

  const wrappersRef = useRef(new Map<number, HTMLDivElement>());
  const canvasesRef = useRef(new Map<number, HTMLCanvasElement>());
  /** Wrapper offsetTop per page (0-based index), rebuilt whenever the layout
   *  can have moved; the scroll math reads this instead of the DOM per frame. */
  const offsetsRef = useRef<number[] | null>(null);
  const sizesRef = useRef<PageSize[] | null>(null);
  const scaleRef = useRef(scale);
  /** Where the viewport top sits: {page, 0..1 fraction inside that page},
   *  updated on every scroll frame and replayed after a scale change. */
  const anchorRef = useRef<{ page: number; topRatio: number } | null>(null);
  const restoredRef = useRef(false);
  /** Restore inputs, captured once at mount: the host gates this component
   *  on having decided them (`scrollRestoreSettled`), and clearing the ratio
   *  after mount must not reach back into a layout that has not run yet. */
  const initialPageRef = useRef(initialPage);
  const initialRatioRef = useRef(initialScrollRatio);
  const lastPingRef = useRef(0);
  const lastReportedPageRef = useRef(0);
  const reportTimerRef = useRef<number | null>(null);

  const onMostVisiblePageRef = useRef(onMostVisiblePage);
  const onScrollActivityRef = useRef(onScrollActivity);
  const onFirstPaintRef = useRef(onFirstPaint);
  const onMountedRef = useRef(onMounted);
  useEffect(() => {
    onMostVisiblePageRef.current = onMostVisiblePage;
    onScrollActivityRef.current = onScrollActivity;
    onFirstPaintRef.current = onFirstPaint;
    onMountedRef.current = onMounted;
  });

  /** Measures every page once (pdf.js caches the proxies, so the later
   *  renders reuse them). Chunked to keep a thousand-page document's parses
   *  from piling into one giant microtask queue. */
  useEffect(() => {
    let cancelled = false;
    const measure = async () => {
      setSizes(null);
      setVisiblePages(new Set());
      offsetsRef.current = null;
      sizesRef.current = null;
      anchorRef.current = null;
      restoredRef.current = false;
      const result: PageSize[] = [];
      const CHUNK = 32;
      try {
        for (let start = 1; start <= doc.numPages; start += CHUNK) {
          const end = Math.min(doc.numPages, start + CHUNK - 1);
          const proxies = await Promise.all(
            Array.from({ length: end - start + 1 }, (_, index) => doc.getPage(start + index)),
          );
          if (cancelled) return;
          for (const pageProxy of proxies) {
            const viewport = pageProxy.getViewport({ scale: 1 });
            result.push({ width: viewport.width, height: viewport.height });
          }
        }
      } catch {
        return; // the document was destroyed under us (book switched) — gone anyway
      }
      if (!cancelled) {
        sizesRef.current = result;
        setSizes(result);
      }
    };
    void measure();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    onMountedRef.current();
    return () => {
      if (reportTimerRef.current !== null) {
        window.clearTimeout(reportTimerRef.current);
        reportTimerRef.current = null;
      }
    };
  }, []);

  const registerWrapper = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element) wrappersRef.current.set(page, element);
    else wrappersRef.current.delete(page);
  }, []);

  const registerCanvas = useCallback((page: number, element: HTMLCanvasElement | null) => {
    if (element) canvasesRef.current.set(page, element);
    else canvasesRef.current.delete(page);
  }, []);

  const handlePainted = useCallback(() => onFirstPaintRef.current(), []);

  /** Reads every wrapper's offsetTop once into the cache. The wrappers carry
   *  their exact sizes in the same commit, so this reflects the layout the
   *  reader sees — measured, not recomputed from CSS constants. */
  const rebuildOffsets = useCallback(() => {
    const current = sizesRef.current;
    if (!current) return;
    const offsets: number[] = new Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      offsets[index] = wrappersRef.current.get(index + 1)?.offsetTop ?? 0;
    }
    offsetsRef.current = offsets;
  }, []);

  /** The page sharing the most area with the viewport, plus where the
   *  viewport top sits inside it — the anchor the scale-change preservation
   *  replays. */
  const computeMostVisible = useCallback((): { page: number; topRatio: number } | null => {
    const el = scrollRef.current;
    const offsets = offsetsRef.current;
    const current = sizesRef.current;
    if (!el || !offsets || !current || current.length === 0) return null;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    let bestPage = 1;
    let bestArea = -1;
    for (let index = 0; index < current.length; index += 1) {
      const top = offsets[index];
      const bottom = top + Math.max(1, Math.floor(current[index].height * scaleRef.current));
      const overlap = Math.min(bottom, viewBottom) - Math.max(top, viewTop);
      if (overlap > bestArea) {
        bestArea = overlap;
        bestPage = index + 1;
      }
    }
    const pageTop = offsets[bestPage - 1];
    const pageHeight = Math.max(1, Math.floor(current[bestPage - 1].height * scaleRef.current));
    const topRatio = Math.min(1, Math.max(0, (viewTop - pageTop) / pageHeight));
    return { page: bestPage, topRatio };
  }, [scrollRef]);

  const reportMostVisibleNow = useCallback(() => {
    const found = computeMostVisible();
    if (!found) return;
    anchorRef.current = found;
    lastReportedPageRef.current = found.page;
    if (reportTimerRef.current !== null) {
      window.clearTimeout(reportTimerRef.current);
      reportTimerRef.current = null;
    }
    onMostVisiblePageRef.current(found.page);
  }, [computeMostVisible]);

  const handleScrollFrame = useCallback(() => {
    const found = computeMostVisible();
    if (!found) return;
    anchorRef.current = found;
    const now = Date.now();
    if (now - lastPingRef.current >= SCROLL_PING_MS) {
      lastPingRef.current = now;
      onScrollActivityRef.current();
    }
    if (found.page !== lastReportedPageRef.current && reportTimerRef.current === null) {
      reportTimerRef.current = window.setTimeout(() => {
        reportTimerRef.current = null;
        const latest = computeMostVisible();
        if (!latest) return;
        lastReportedPageRef.current = latest.page;
        onMostVisiblePageRef.current(latest.page);
      }, PAGE_REPORT_DELAY_MS);
    }
  }, [computeMostVisible]);

  /** Promotes/demotes page slots as they drift through the render window.
   *  The wrappers persist across renders, so observing once per measured
   *  document is enough — the observer tracks their boxes on its own. */
  useEffect(() => {
    if (!sizes) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((previous) => {
          let changed = false;
          const next = new Set(previous);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pdfPage);
            if (!page) continue;
            if (entry.isIntersecting) {
              if (!next.has(page)) {
                next.add(page);
                changed = true;
              }
            } else if (next.delete(page)) {
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      },
      { root, rootMargin: RENDER_WINDOW_MARGIN },
    );
    for (const wrapper of wrappersRef.current.values()) observer.observe(wrapper);
    return () => observer.disconnect();
  }, [sizes, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sizes) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        handleScrollFrame();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sizes, handleScrollFrame, scrollRef]);

  /** Offset cache maintenance + the two repositioning moments:
   *  a scale change replays the viewport anchor against the new geometry, and
   *  the first layout restores the saved ratio (or lands on `initialPage`).
   *  A layout effect, so both land before the first paint of the new geometry. */
  useLayoutEffect(() => {
    if (!sizes || sizes.length === 0) return;
    rebuildOffsets();
    const el = scrollRef.current;
    if (!el) return;
    if (scaleRef.current !== scale) {
      scaleRef.current = scale;
      const anchor = anchorRef.current;
      const offsets = offsetsRef.current;
      if (anchor && offsets) {
        const pageHeight = Math.max(1, Math.floor(sizes[anchor.page - 1].height * scale));
        el.scrollTop = Math.max(0, offsets[anchor.page - 1] + anchor.topRatio * pageHeight);
      }
    }
    if (!restoredRef.current) {
      restoredRef.current = true;
      const ratio = initialRatioRef.current;
      const max = el.scrollHeight - el.clientHeight;
      if (ratio !== null && ratio > 0 && max > 0) {
        el.scrollTop = Math.min(max, ratio * max);
        // The placeholders have exact heights, so this lands on the first
        // write; the nudges only cover a late relayout (fit settling, fonts).
        let left = 3;
        const tick = () => {
          const range = el.scrollHeight - el.clientHeight;
          if (range > 0) el.scrollTop = Math.min(range, ratio * range);
          left -= 1;
          if (left > 0) window.setTimeout(() => requestAnimationFrame(tick), 120);
        };
        window.setTimeout(() => requestAnimationFrame(tick), 120);
      } else {
        const target = Math.min(Math.max(1, initialPageRef.current), sizes.length);
        const offsets = offsetsRef.current;
        if (offsets) el.scrollTop = Math.max(0, offsets[target - 1]);
      }
      // Report where the restore actually landed and ping the host once, so
      // the stored ratio matches the anchor from the very first moment.
      requestAnimationFrame(() => {
        reportMostVisibleNow();
        onScrollActivityRef.current();
      });
    }
  }, [sizes, scale, rebuildOffsets, reportMostVisibleNow, scrollRef]);

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      const el = scrollRef.current;
      const offsets = offsetsRef.current;
      const current = sizesRef.current;
      if (!el || !offsets || !current || current.length === 0) return;
      const target = Math.min(Math.max(1, Math.round(page)), current.length);
      el.scrollTop = Math.max(0, offsets[target - 1]);
    },
    getScrollRatio: () => {
      const el = scrollRef.current;
      if (!el) return null;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return null;
      return Math.min(1, Math.max(0, el.scrollTop / max));
    },
    getPageCanvas: (page: number) => canvasesRef.current.get(page) ?? null,
  }));

  const handleContainerClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("[data-pdf-page]")) return;
      onBackgroundClick();
    },
    [onBackgroundClick],
  );

  /** The page the trim overlay is pinned to stays rendered even when the
   *  reader scrolls it out of the window mid-edit — the overlay would
   *  otherwise lose the surface it draws on. */
  const renderedPages = (() => {
    const set = new Set(visiblePages);
    if (regionEditPage !== null) set.add(regionEditPage);
    return set;
  })();

  if (!sizes) {
    return (
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.loading} aria-label="Preparing pages">
          <Loader2 className={styles.spinner} size={24} strokeWidth={2} />
          <span>Preparing pages…</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.scroll} ref={scrollRef} onClick={handleContainerClick}>
      <div className={styles.column}>
        {sizes.map((size, index) => {
          const page = index + 1;
          return (
            <ScrollPage
              key={page}
              page={page}
              doc={doc}
              cssWidth={Math.floor(size.width * scale)}
              cssHeight={Math.floor(size.height * scale)}
              scale={scale}
              render={renderedPages.has(page)}
              linkService={linkService}
              scanRegion={scanRegion}
              regionEditing={regionEditPage === page}
              onRegionCommit={onRegionCommit}
              onRegionCancel={onRegionCancel}
              onPageClick={onPageClick}
              onPageContextMenu={onPageContextMenu}
              registerWrapper={registerWrapper}
              registerCanvas={registerCanvas}
              onPainted={handlePainted}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Refs the parent's callbacks are mirrored into, so a memoized page keeps a
 *  stable prop set while the host's handlers stay fresh. */
interface ScrollPageCallbacks {
  onPageClick: (page: number, event: ReactMouseEvent<HTMLDivElement>) => void;
  onPageContextMenu: (page: number, event: ReactMouseEvent<HTMLDivElement>) => void;
}

interface ScrollPageProps {
  page: number;
  doc: PDFDocumentProxy;
  cssWidth: number;
  cssHeight: number;
  scale: number;
  render: boolean;
  linkService: PDFLinkService;
  scanRegion: PdfScanRegion | null;
  regionEditing: boolean;
  onRegionCommit: (region: PdfScanRegion | null) => void;
  onRegionCancel: () => void;
  registerWrapper: (page: number, element: HTMLDivElement | null) => void;
  registerCanvas: (page: number, element: HTMLCanvasElement | null) => void;
  onPainted: () => void;
}

/** One slot of the column: an exactly-sized wrapper that turns into a real
 *  page (canvas, text layer, annotation layer, scan-region UI) while it is
 *  inside the render window, and back to a bare placeholder when it leaves.
 *  The wrapper keeps its size either way, so scrolling never jumps. */
const ScrollPage = memo(function ScrollPage({
  page,
  doc,
  cssWidth,
  cssHeight,
  scale,
  render,
  linkService,
  scanRegion,
  regionEditing,
  onRegionCommit,
  onRegionCancel,
  onPageClick,
  onPageContextMenu,
  registerWrapper,
  registerCanvas,
  onPainted,
}: ScrollPageProps & ScrollPageCallbacks) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const annotationRef = useRef<HTMLDivElement | null>(null);
  const [rendering, setRendering] = useState(false);

  const onPaintedRef = useRef(onPainted);
  const onPageClickRef = useRef(onPageClick);
  const onPageContextMenuRef = useRef(onPageContextMenu);
  useEffect(() => {
    onPaintedRef.current = onPainted;
    onPageClickRef.current = onPageClick;
    onPageContextMenuRef.current = onPageContextMenu;
  });

  const attachWrapper = useCallback(
    (element: HTMLDivElement | null) => registerWrapper(page, element),
    [page, registerWrapper],
  );
  const attachCanvas = useCallback(
    (element: HTMLCanvasElement | null) => {
      canvasRef.current = element;
      registerCanvas(page, element);
    },
    [page, registerCanvas],
  );
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => onPageClickRef.current(page, event),
    [page],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => onPageContextMenuRef.current(page, event),
    [page],
  );

  /** Renders the page into the slot at the current scale. Owns its render
   *  task: leaving the window (or a zoom) cancels it, and pdf.js frees the
   *  half-painted bitmap. */
  useEffect(() => {
    if (!render) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    const run = async () => {
      setRendering(true);
      try {
        const pageProxy = await doc.getPage(page);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const viewport = pageProxy.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const outputScale = dpr;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const transform: number[] | undefined =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        task = pageProxy.render({ canvas, viewport, transform });
        await task.promise;
        if (cancelled) return;
        onPaintedRef.current();
        const textContainer = textRef.current;
        if (textContainer) {
          textContainer.textContent = "";
          textLayer = new TextLayer({
            textContentSource: pageProxy.streamTextContent(),
            container: textContainer,
            viewport,
          });
          void textLayer.render().catch(() => {
            // Cosmetic overlay: a failed text layer must not break the page.
          });
        }
        const annotationDiv = annotationRef.current;
        if (annotationDiv) {
          try {
            annotationDiv.textContent = "";
            const annotations = await pageProxy.getAnnotations();
            if (cancelled) return;
            const annotationLayer = new AnnotationLayer({
              div: annotationDiv,
              page: pageProxy,
              viewport,
              linkService,
              accessibilityManager: undefined,
              annotationCanvasMap: undefined,
              annotationEditorUIManager: undefined,
              structTreeLayer: undefined,
              commentManager: undefined,
              annotationStorage: undefined,
            });
            await annotationLayer.render({
              annotations,
              viewport,
              div: annotationDiv,
              page: pageProxy,
              linkService,
              renderForms: false,
            });
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "RenderingCancelledException") return;
            // Annotation rendering is decorative — a failure must not fail the page.
          }
        }
      } catch {
        // Cancelled (left the window, zoom changed) or failed: the slot stays
        // a blank page-sized placeholder either way.
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [doc, page, scale, render, linkService]);

  const showHint = !regionEditing && !isWholePageScanRegion(scanRegion);

  return (
    <div
      ref={attachWrapper}
      data-pdf-page={page}
      className={`${styles.page} pdf-page`}
      style={
        { width: cssWidth, height: cssHeight, "--scale-factor": String(scale) } as CSSProperties
      }
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {render ? (
        <>
          <canvas
            ref={attachCanvas}
            className={`${styles.canvas} pdf-canvas`}
            style={{ width: cssWidth, height: cssHeight }}
          />
          <div className="pdf-canvas-tint" aria-hidden="true" />
          <div ref={textRef} className="pdf-text-layer textLayer" />
          <div ref={annotationRef} className="pdf-annotation-layer annotationLayer" />
        </>
      ) : null}
      {showHint && (
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
      {regionEditing && (
        <PdfScanRegionOverlay
          region={scanRegion}
          onCommit={onRegionCommit}
          onClose={onRegionCancel}
        />
      )}
      {rendering && (
        <div className={styles.rendering} aria-hidden="true">
          <Loader2 className={styles.spinner} size={20} strokeWidth={2} />
        </div>
      )}
    </div>
  );
});
