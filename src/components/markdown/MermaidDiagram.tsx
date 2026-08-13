import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import mermaid from "mermaid";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "../../app/providers/theme/ThemeContext";
import styles from "./MermaidDiagram.module.css";

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.2;
const DOUBLE_TAP_MS = 300;
/** Fraction of the container the diagram should occupy, so it renders with
 *  20% of breathing space around it. */
const FIT_MARGIN = 0.8;

/** Mermaid "base" theme recolored from the app's design tokens so diagrams
 *  match the active theme (calm mountain morning / moonlit mountain evening)
 *  instead of mermaid's defaults. The svg background stays transparent so
 *  the card surface shows through. */
const MERMAID_LIGHT_THEME = {
  theme: "base",
  themeVariables: {
    background: "transparent",
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    primaryColor: "#fff8f0",
    primaryTextColor: "#322b26",
    primaryBorderColor: "#5b6b50",
    secondaryColor: "#efe3d2",
    secondaryTextColor: "#4c382b",
    tertiaryColor: "#e6ded0",
    lineColor: "#6f675e",
    textColor: "#322b26",
    edgeLabelBackground: "#fff8f0",
    clusterBkg: "rgba(239, 227, 210, 0.55)",
    clusterBorder: "#9b9289",
    noteBkgColor: "rgba(239, 227, 210, 0.8)",
    noteBorderColor: "#9b9289",
    titleColor: "#322b26",
  },
} as const;

const MERMAID_DARK_THEME = {
  theme: "base",
  themeVariables: {
    background: "transparent",
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    primaryColor: "#1f2b43",
    primaryTextColor: "#eef2f7",
    primaryBorderColor: "#8fa8c7",
    secondaryColor: "#162033",
    secondaryTextColor: "#d9e0ee",
    tertiaryColor: "#2c3a57",
    lineColor: "#c5ccd8",
    textColor: "#eef2f7",
    edgeLabelBackground: "#1f2b43",
    clusterBkg: "rgba(22, 32, 51, 0.7)",
    clusterBorder: "#95a0b2",
    noteBkgColor: "rgba(44, 58, 87, 0.8)",
    noteBorderColor: "#95a0b2",
    titleColor: "#eef2f7",
  },
} as const;

const createMermaidId = (() => {
  let count = 0;
  return () => `mermaid-diagram-${++count}`;
})();

/* ---------- Label contrast ----------
 * Mermaid picks one text color per diagram from its theme, but AI-generated
 * charts often paint individual boxes with their own fills via style/classDef.
 * A light-blue box can then end up with white text, or a dark box with dark
 * text. The fixer below walks every labelled box after render and recolors
 * the label from the box's actual fill, using WCAG relative luminance, so the
 * text always matches its box while the box colors stay as authored. */

const NODE_GROUP_SELECTOR =
  "g.node, g.cluster, g.stateGroup, g.state, g.actor, g.quadrant, g.entityBox";
const LABEL_SELECTOR =
  "text, tspan, .nodeLabel, .label, .stateLabel, .classTitle, .entityLabel";

const DARK_TEXT_COLOR = "#322b26"; // --color-text (light theme)
const LIGHT_TEXT_COLOR = "#eef2f7"; // --color-text (dark theme)

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): RgbColor | null {
  const v = value.trim();
  if (!v || v === "none" || v === "transparent") return null;
  let match = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((ch) => ch + ch).join("");
    }
    const num = parseInt(hex.slice(0, 6), 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  match = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (match) {
    const parts = match[1].split(",").map((part) => part.trim());
    const channels = parts.slice(0, 3).map((part) =>
      part.endsWith("%") ? (parseFloat(part) / 100) * 255 : parseFloat(part),
    );
    if (channels.some((channel) => Number.isNaN(channel))) return null;
    return {
      r: channels[0],
      g: channels[1],
      b: channels[2],
      a: parts[3] !== undefined ? parseFloat(parts[3]) : 1,
    };
  }
  return null;
}

function colorLuminance({ r, g, b }: RgbColor): number {
  const linear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Picks whichever theme text color reads better on the given fill. */
function readableTextColor(fill: RgbColor): string {
  const fillLum = colorLuminance(fill);
  const darkLum = colorLuminance(parseColor(DARK_TEXT_COLOR)!);
  const lightLum = colorLuminance(parseColor(LIGHT_TEXT_COLOR)!);
  return contrastRatio(fillLum, darkLum) >= contrastRatio(fillLum, lightLum)
    ? DARK_TEXT_COLOR
    : LIGHT_TEXT_COLOR;
}

function shapeFill(group: SVGElement): RgbColor | null {
  const shape = group.querySelector("rect, polygon, ellipse, circle, path");
  if (!shape) return null;
  const styleFill = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(shape.getAttribute("style") ?? "");
  const raw = styleFill ? styleFill[1].trim() : shape.getAttribute("fill");
  if (!raw) return null;
  const color = parseColor(raw);
  if (!color || color.a < 0.8) return null;
  return color;
}

function fixLabelContrast(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const groups = svg.querySelectorAll<SVGElement>(NODE_GROUP_SELECTOR);
  for (const group of groups) {
    // Nested groups (nodes inside clusters/subgraphs, states inside states)
    // fix themselves; the outer group must not recolor their labels.
    const nested = group.querySelectorAll<SVGElement>(NODE_GROUP_SELECTOR);
    const insideNested = (el: Element) =>
      [...nested].some((n) => n !== group && n.contains(el));
    const fill = shapeFill(group);
    if (!fill) continue;
    const color = readableTextColor(fill);
    const labels = group.querySelectorAll<Element>(LABEL_SELECTOR);
    for (const label of labels) {
      if (insideNested(label)) continue;
      if (label.tagName === "text" || label.tagName === "tspan") {
        (label as SVGElement).style.fill = color;
        label.setAttribute("fill", color);
      } else {
        (label as HTMLElement).style.color = color;
      }
    }
  }
}

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const { theme } = useTheme();
  const diagramRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const fitScaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef(0);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const updateTransform = (nextScale: number, nextPosition: { x: number; y: number }) => {
    scaleRef.current = nextScale;
    positionRef.current = nextPosition;
    setScale(nextScale);
    setPosition(nextPosition);
  };

  /** Scales the diagram so it fits the container with 20% of space around it
   *  (80% of the area on each axis), centred. */
  const fitToContainer = useCallback(() => {
    const container = containerRef.current;
    const natural = naturalSizeRef.current;
    if (!container || !natural) return;
    const usableWidth = container.clientWidth * FIT_MARGIN;
    const usableHeight = container.clientHeight * FIT_MARGIN;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(usableWidth / natural.width, usableHeight / natural.height)),
    );
    fitScaleRef.current = nextScale;
    updateTransform(nextScale, { x: 0, y: 0 });
  }, []);

  /** Renders the chart into the container; re-runs when the chart or the app
   *  theme changes because mermaid bakes the colors into the svg at render
   *  time. */
  useEffect(() => {
    const config = theme === "dark" ? MERMAID_DARK_THEME : MERMAID_LIGHT_THEME;
    mermaid.initialize({ startOnLoad: false, ...config });
    let cancelled = false;
    mermaid
      .render(createMermaidId(), chart)
      .then(({ svg }) => {
        if (cancelled) return;
        const host = diagramRef.current;
        if (!host) return;
        host.innerHTML = svg;
        setError(null);
        fixLabelContrast(host);
        // Render the svg at its natural size (drop mermaid's max-width: 100%)
        // so the fit scale below is exact instead of compounding with the
        // squish mermaid would otherwise apply.
        const svgEl = host.querySelector("svg");
        const vb = svgEl?.viewBox?.baseVal;
        if (svgEl && vb && vb.width > 0 && vb.height > 0) {
          svgEl.style.maxWidth = "none";
          svgEl.setAttribute("width", String(vb.width));
          svgEl.setAttribute("height", String(vb.height));
          naturalSizeRef.current = { width: vb.width, height: vb.height };
        } else {
          naturalSizeRef.current = null;
        }
        fitToContainer();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chart, theme, fitToContainer]);

  const resetTransform = () => updateTransform(fitScaleRef.current, { x: 0, y: 0 });

  /* ---------- Mouse: drag to pan, wheel to zoom ---------- */

  const handleMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = {
      x: event.clientX - positionRef.current.x,
      y: event.clientY - positionRef.current.y,
    };
  };

  const handleMouseMove = (event: ReactMouseEvent) => {
    if (!isDraggingRef.current) return;
    updateTransform(scaleRef.current, {
      x: event.clientX - dragStartRef.current.x,
      y: event.clientY - dragStartRef.current.y,
    });
  };

  const stopDragging = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  /* ---------- Touch: one finger drag, two finger pinch, double tap reset ---------- */

  const touchDistance = (touches: ReactTouchEvent["touches"]) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (event: ReactTouchEvent) => {
    if (event.touches.length === 1) {
      const now = performance.now();
      if (now - lastTapTimeRef.current < DOUBLE_TAP_MS) {
        resetTransform();
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;
      isDraggingRef.current = true;
      touchStartRef.current = {
        x: event.touches[0].clientX - positionRef.current.x,
        y: event.touches[0].clientY - positionRef.current.y,
      };
    } else if (event.touches.length === 2) {
      isDraggingRef.current = false;
      lastTouchDistRef.current = touchDistance(event.touches);
    }
  };

  const handleTouchMove = (event: ReactTouchEvent) => {
    if (event.touches.length === 1 && isDraggingRef.current) {
      updateTransform(scaleRef.current, {
        x: event.touches[0].clientX - touchStartRef.current.x,
        y: event.touches[0].clientY - touchStartRef.current.y,
      });
    } else if (event.touches.length === 2 && lastTouchDistRef.current !== null) {
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(
          MIN_SCALE,
          scaleRef.current + (touchDistance(event.touches) - lastTouchDistRef.current) * 0.005,
        ),
      );
      updateTransform(nextScale, positionRef.current);
    }
  };

  const handleTouchEnd = (event: ReactTouchEvent) => {
    if (event.touches.length < 2) lastTouchDistRef.current = null;
    if (event.touches.length === 0) isDraggingRef.current = false;
  };

  const transformStyle: CSSProperties = {
    transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
  };

  const containerClasses = [
    styles.container,
    isDragging ? styles.dragging : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDragging}
      onMouseLeave={stopDragging}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={styles.controls}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.controlButton}
          onClick={() =>
            updateTransform(Math.min(scaleRef.current + ZOOM_STEP, MAX_SCALE), positionRef.current)
          }
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() =>
            updateTransform(Math.max(scaleRef.current - ZOOM_STEP, MIN_SCALE), positionRef.current)
          }
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={resetTransform}
          aria-label="Reset zoom and position"
          title="Reset zoom and position"
        >
          <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <span className={styles.scaleBadge}>{Math.round(scale * 100)}%</span>
      <span className={styles.hint}>Drag to pan · Double-tap to reset</span>
      {error ? (
        <div className={styles.error}>Failed to render diagram — {error}</div>
      ) : (
        <div ref={diagramRef} className={styles.diagram} style={transformStyle} />
      )}
    </div>
  );
}