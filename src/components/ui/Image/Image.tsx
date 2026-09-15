import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, Maximize2, Minus, Plus, X } from "lucide-react";
import styles from "./Image.module.css";

export const IMAGE_ZOOM_MIN = 25;
export const IMAGE_ZOOM_MAX = 400;
export const IMAGE_ZOOM_STEP = 25;

interface ImageProps {
  src?: string;
  alt: string;
  aspectRatio?: string;
  className?: string;
  /** Controlled per-book global zoom (25..400). When omitted the image keeps
   *  its own in-memory zoom starting from `defaultZoom`. */
  zoomPct?: number;
  defaultZoom?: number;
  /** Called with the clamped next zoom; parents persist it per book so every
   *  image of the book shares one value. */
  onZoomChange?: (next: number) => void;
}

type ImageStatus = "loading" | "loaded" | "error";

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, Math.round(value)));
}

export function Image({
  src,
  alt,
  aspectRatio = "4 / 3",
  className = "",
  zoomPct,
  defaultZoom = 100,
  onZoomChange,
}: ImageProps) {
  const [renderedSrc, setRenderedSrc] = useState(src);
  const [status, setStatus] = useState<ImageStatus>(() => (src ? "loading" : "error"));
  const [ratio, setRatio] = useState(aspectRatio);
  const [innerZoom, setInnerZoom] = useState(() => clampZoom(defaultZoom));
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayViewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  if (src !== renderedSrc) {
    setRenderedSrc(src);
    setStatus(src ? "loading" : "error");
    setRatio(aspectRatio);
  }

  const controlled = typeof zoomPct === "number";
  const zoom = clampZoom(controlled ? (zoomPct as number) : innerZoom);
  const scaled = zoom !== 100;
  /** Panning is automatic: any zoom past 100% makes the surface draggable
   *  (plus native scrollbars/wheel), so no hand toggle is needed. */
  const canPan = zoom > 100;

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      if (controlled) {
        onZoomChange?.(clamped);
      } else {
        setInnerZoom(clamped);
        onZoomChange?.(clamped);
      }
    },
    [controlled, onZoomChange],
  );

  const changeZoom = useCallback((delta: number) => applyZoom(zoom + delta), [applyZoom, zoom]);

  /** Closes the fullscreen overlay with Escape. */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  // NOTE: `overlayOpen` is derived below; the Escape handler above intentionally
  // watches `fullscreen` so it is registered before the image finishes loading.

  const startPan = (event: ReactPointerEvent<HTMLDivElement>, view: HTMLDivElement | null) => {
    if (!canPan || !view) return;
    // Only the primary button starts a drag; otherwise native scrolling
    // (wheel / touch / scrollbars) still works.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: view.scrollLeft,
      top: view.scrollTop,
    };
    setDragging(true);
    view.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>, view: HTMLDivElement | null) => {
    const drag = dragRef.current;
    if (!drag || !view) return;
    view.scrollLeft = drag.left - (event.clientX - drag.x);
    view.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const endPan = () => {
    dragRef.current = null;
    setDragging(false);
  };

  /** The same hover pill in place and in fullscreen; in fullscreen the last
   *  button exits instead of entering. */
  const toolbar = (showExit: boolean) => (
    <span
      className={styles.toolbar}
      role="toolbar"
      aria-label="Image controls"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`${styles.toolButton} ${styles.collapsible}`}
        onClick={() => changeZoom(-IMAGE_ZOOM_STEP)}
        disabled={zoom <= IMAGE_ZOOM_MIN}
        aria-label="Zoom image out"
        title="Zoom image out"
      >
        <Minus size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${styles.zoomValue} ${styles.collapsible}`}
        onClick={() => applyZoom(100)}
        aria-label={`Image zoom ${zoom} percent, click to reset`}
        title="Reset image zoom to 100%"
      >
        {zoom}%
      </button>
      <button
        type="button"
        className={`${styles.toolButton} ${styles.collapsible}`}
        onClick={() => changeZoom(IMAGE_ZOOM_STEP)}
        disabled={zoom >= IMAGE_ZOOM_MAX}
        aria-label="Zoom image in"
        title="Zoom image in"
      >
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.toolButton}
        onClick={() => setFullscreen((open) => !open)}
        aria-label={showExit ? "Exit image fullscreen" : "View image fullscreen"}
        title={showExit ? "Exit fullscreen" : "View fullscreen"}
      >
        {showExit ? (
          <X size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Maximize2 size={14} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </span>
  );

  /** Below 100% the image shrinks inside its frame (contained, so it stays
   *  fully visible) and stays centered; past 100% it outgrows the frame and
   *  the surface pans. */
  const scaledImgStyle = scaled
    ? {
        width: `${zoom}%`,
        ...(zoom > 100 ? { maxWidth: "none", height: "auto" } : { margin: "0 auto" }),
      }
    : undefined;
  /** Below 100% the fullscreen stage centers the shrunken picture on both
   *  axes. `safe` keeps the top reachable on overflow (extremely tall
   *  images), falling back to start alignment instead of clipping. */
  const overlayCenterStyle =
    zoom < 100
      ? { display: "flex", alignItems: "safe center", justifyContent: "safe center" }
      : undefined;

  const viewportClass = [
    styles.viewport,
    canPan ? styles.viewportZoomed : "",
    canPan ? styles.pannable : "",
    dragging ? styles.dragging : "",
  ]
    .filter(Boolean)
    .join(" ");
  const overlayOpen = fullscreen && Boolean(src) && status === "loaded";

  return (
    <>
      <span
        className={`${styles.frame} ${className} ${overlayOpen ? styles.frameHidden : ""}`}
        style={{ aspectRatio: ratio }}
      >
        {toolbar(false)}
        <div
          ref={viewportRef}
          className={viewportClass}
          onPointerDown={(event) => startPan(event, viewportRef.current)}
          onPointerMove={(event) => movePan(event, viewportRef.current)}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          {src && (
            <img
              src={src}
              alt={alt}
              draggable={false}
              className={status === "loaded" ? styles.img : styles.imgHidden}
              style={scaledImgStyle}
              onLoad={(event) => {
                const img = event.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
                }
                setStatus("loaded");
              }}
              onError={() => setStatus("error")}
            />
          )}
        </div>
        {status !== "loaded" && (
          <span className={styles.placeholder} role="img" aria-label={alt}>
            <ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />
            <span>{status === "loading" ? "Loading…" : "No image"}</span>
          </span>
        )}
      </span>
      {overlayOpen &&
        src &&
        createPortal(
          <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onClick={() => setFullscreen(false)}
          >
            <div
              className={styles.overlayInner}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {toolbar(true)}
            <div
              ref={overlayViewportRef}
              className={`${viewportClass} ${styles.overlayViewport}`}
              style={overlayCenterStyle}
              onPointerDown={(event) => startPan(event, overlayViewportRef.current)}
                onPointerMove={(event) => movePan(event, overlayViewportRef.current)}
                onPointerUp={endPan}
                onPointerCancel={endPan}
              >
                <img
                  src={src}
                  alt={alt}
                  draggable={false}
                  className={styles.overlayImg}
                  style={scaledImgStyle}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
