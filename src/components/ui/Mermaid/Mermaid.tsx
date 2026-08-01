import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { LocateFixed, Maximize, Minimize, ZoomIn, ZoomOut } from "lucide-react";
import mermaid from "mermaid";
import { useTheme } from "../../../app/providers/theme/ThemeContext";
import type { Theme } from "../../../shared/types";
import styles from "./Mermaid.module.css";

let diagramCount = 0;

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

interface ViewState {
  x: number;
  y: number;
  z: number;
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface MermaidProps {
  code: string;
  className?: string;
  ariaLabel?: string;
}

interface RenderResult {
  code: string;
  theme: Theme;
  svg: string;
}

interface RenderFailure {
  code: string;
  theme: Theme;
  message: string;
}

export function Mermaid({ code, className = "", ariaLabel = "Diagram" }: MermaidProps) {
  const { theme } = useTheme();
  const [result, setResult] = useState<RenderResult | null>(null);
  const [failure, setFailure] = useState<RenderFailure | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const id = useMemo(() => `readlynx-diagram-${++diagramCount}`, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const renderedCodeRef = useRef("");
  const shouldFitRef = useRef(true);
  const viewRef = useRef<ViewState>({ x: 0, y: 0, z: 1 });
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });

  const fitZoom = useCallback(() => {
    const host = viewportRef.current;
    const layer = layerRef.current;
    if (!host || !layer) return ZOOM_MIN;
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    if (width === 0 || height === 0) return ZOOM_MIN;
    const fit = Math.min(host.clientWidth / width, host.clientHeight / height);
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit));
  }, []);

  const applyTransform = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const { x, y, z } = viewRef.current;
    layer.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
  }, []);

  const centerView = useCallback(
    (targetZoom: number) => {
      const host = viewportRef.current;
      const layer = layerRef.current;
      if (!host || !layer) return;
      const width = layer.offsetWidth;
      const height = layer.offsetHeight;
      viewRef.current = {
        x: width > 0 ? (host.clientWidth - width * targetZoom) / 2 : 0,
        y: height > 0 ? (host.clientHeight - height * targetZoom) / 2 : 0,
        z: targetZoom,
      };
      applyTransform();
      setZoom(targetZoom);
    },
    [applyTransform],
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const host = viewportRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const vx = clientX - rect.left;
      const vy = clientY - rect.top;
      const view = viewRef.current;
      const layerX = (vx - view.x) / view.z;
      const layerY = (vy - view.y) / view.z;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.z * factor));
      if (next === view.z) return;
      viewRef.current = { x: vx - layerX * next, y: vy - layerY * next, z: next };
      applyTransform();
      setZoom(next);
    },
    [applyTransform],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const host = viewportRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      viewRef.current.x += dx;
      viewRef.current.y += dy;
      applyTransform();
    },
    [applyTransform],
  );

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          background: "transparent",
          fontFamily: readToken("--font-sans"),
          fontSize: "13px",
          primaryColor: readToken("--color-primary"),
          primaryTextColor: readToken("--color-on-primary"),
          primaryBorderColor: readToken("--color-primary"),
          secondaryColor: readToken("--color-active"),
          secondaryTextColor: readToken("--color-text"),
          secondaryBorderColor: readToken("--color-border"),
          tertiaryColor: readToken("--color-glass"),
          tertiaryTextColor: readToken("--color-text-secondary"),
          tertiaryBorderColor: readToken("--color-border"),
          lineColor: readToken("--color-text-secondary"),
          textColor: readToken("--color-text"),
          edgeLabelBackground: readToken("--color-glass"),
          clusterBkg: readToken("--color-glass"),
          clusterBorder: readToken("--color-border"),
        },
      });

      try {
        const rendered = await mermaid.render(id, code);
        if (cancelled) return;
        if (renderedCodeRef.current !== code) {
          renderedCodeRef.current = code;
          shouldFitRef.current = true;
        }
        setFailure(null);
        setResult({ code, theme, svg: rendered.svg });
      } catch (err: unknown) {
        if (cancelled) return;
        setResult(null);
        setFailure({ code, theme, message: err instanceof Error ? err.message : String(err) });
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, id, theme]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement !== containerRef.current) shouldFitRef.current = true;
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  useEffect(() => {
    const host = viewportRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        const rect = host.getBoundingClientRect();
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.1 : 1 / 1.1);
      } else {
        panBy(-event.deltaX, -event.deltaY);
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [panBy, zoomAt]);

  useLayoutEffect(() => {
    if (!result) return;
    const svg = svgHostRef.current?.querySelector("svg");
    if (!svg) return;
    if (svg.clientWidth > 0) setNaturalWidth(svg.clientWidth);
    if (svg.clientHeight > 0) setNaturalHeight(svg.clientHeight);
  }, [result]);

  useLayoutEffect(() => {
    if (naturalWidth === 0) return;
    if (shouldFitRef.current) {
      shouldFitRef.current = false;
      centerView(fitZoom());
    } else {
      centerView(viewRef.current.z);
    }
  }, [naturalWidth, naturalHeight, isFullscreen, centerView, fitZoom]);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen unavailable — ignore
    }
  };

  const handlePanStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = viewportRef.current;
    if (!host) return;
    dragRef.current = { active: true, lastX: event.clientX, lastY: event.clientY };
    host.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePanMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    panBy(event.clientX - drag.lastX, event.clientY - drag.lastY);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  const handlePanEnd = () => {
    dragRef.current.active = false;
    setIsDragging(false);
  };

  // Only gate on the code: while the theme re-renders, keep showing the
  // previous diagram until the freshly colored one arrives — avoids a
  // placeholder flash and preserves the pan/zoom view.
  const isCurrent = (entry: { code: string } | null): entry is RenderResult =>
    entry !== null && entry.code === code;

  const currentResult = isCurrent(result) ? result : null;
  const currentFailure = isCurrent(failure) ? failure : null;
  const classes = [styles.diagram, isFullscreen ? styles.fullscreen : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className={classes}>
      {currentFailure ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>Could not render diagram</p>
          <pre className={styles.errorCode}>{currentFailure.message}</pre>
        </div>
      ) : currentResult ? (
        <>
          <div
            ref={viewportRef}
            className={`${styles.zoomHost} ${isDragging ? styles.dragging : ""}`}
            onPointerDown={handlePanStart}
            onPointerMove={handlePanMove}
            onPointerUp={handlePanEnd}
            onPointerCancel={handlePanEnd}
            onDoubleClick={() => centerView(fitZoom())}
          >
            <div
              ref={layerRef}
              className={styles.zoomable}
              style={{
                width: naturalWidth > 0 ? naturalWidth : undefined,
                height: naturalHeight > 0 ? naturalHeight : undefined,
              }}
            >
              <div
                ref={svgHostRef}
                role="img"
                aria-label={ariaLabel}
                className={styles.svgHost}
                dangerouslySetInnerHTML={{ __html: currentResult.svg }}
              />
            </div>
          </div>

          <div className={styles.toolbar} role="toolbar" aria-label="Diagram controls">
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => zoomBy(1 - ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.zoomValue}
              onClick={() => centerView(fitZoom())}
              aria-label={`Zoom ${Math.round(zoom * 100)} percent, click to fit`}
              title="Fit diagram in view"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => zoomBy(1 + ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className={styles.toolDivider} aria-hidden="true" />
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => centerView(viewRef.current.z)}
              aria-label="Reset position"
              title="Reset position"
            >
              <LocateFixed size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize size={14} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize size={14} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.placeholder} aria-hidden="true" />
      )}
    </div>
  );
}
