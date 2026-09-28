import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import mermaid from "mermaid";
import { mermaidRecoveryLadder } from "./mermaidRepair";
import { mermaidConfig } from "./mermaidTheme";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "../../app/providers/theme/ThemeContext";
import type { MarkdownBlockTheme } from "../../infrastructure/db/entities/ReaderSettings.ts";
import styles from "./MermaidDiagram.module.css";

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.2;
const DOUBLE_TAP_MS = 300;
/** Fraction of the container the diagram should occupy, so it renders with
 *  20% of breathing space around it. */
const FIT_MARGIN = 0.8;

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
  /** Fixed diagram theme; null/undefined = follow the app theme. */
  themeOverride?: MarkdownBlockTheme | null;
  /** Fixed card background; null/undefined = follow the theme card. */
  background?: string | null;
}

interface MermaidFailure {
  /** Full parser message, shown verbatim rather than summarised away. */
  message: string;
  /** The model's own source, so a bad diagram can be read and fixed. */
  source: string;
}

/** Mermaid's parser dumps the offending line plus a long list of expected
 *  tokens. Keep the whole thing — it is the only clue to what went wrong — but
 *  on one line so it cannot blow up the card. */
function describeFailure(err: unknown, source: string): MermaidFailure {
  const message = err instanceof Error ? err.message : String(err);
  return { message: message.replace(/\s*\n\s*/g, " ").trim(), source };
}

export function MermaidDiagram({ chart, themeOverride, background }: MermaidDiagramProps) {
  const { theme } = useTheme();
  const effectiveTheme = themeOverride ?? theme;
  const diagramRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const fitScaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [failure, setFailure] = useState<MermaidFailure | null>(null);

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

  /** Renders the chart into the container; re-runs when the chart or the
   *  effective theme changes because mermaid bakes the colors into the svg
   *  at render time.
   *
   *  A model-produced diagram is often *nearly* valid — one label holding a
   *  bracket or a parenthesis is enough. So the render is attempted over a
   *  list of candidates: the source as written first, then the repair that
   *  quotes offending labels, then a lossy repair that drops them. Each
   *  candidate is only accepted once mermaid itself has parsed it, so the
   *  original text is never lost and a wrong guess cannot corrupt the diagram. */
  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, ...mermaidConfig(effectiveTheme) });
    let cancelled = false;
    const paint = (svg: string) => {
      const host = diagramRef.current;
      if (!host) return;
      host.innerHTML = svg;
      setFailure(null);
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
    };
    void (async () => {
      let lastError: unknown = null;
      // The ladder asks the parser first and yields only sources it accepts, so
      // the common failure is skipped over without paying for a layout pass.
      for await (const attempt of mermaidRecoveryLadder(chart, (source) =>
        mermaid.parse(source).then(
          () => true,
          () => false,
        ),
      )) {
        // A fresh id per attempt: mermaid leaves its scratch element behind
        // when a parse fails, and a reused id would collide with it.
        try {
          const { svg } = await mermaid.render(createMermaidId(), attempt.source);
          if (cancelled) return;
          paint(svg);
          return;
        } catch (err) {
          lastError = err;
        }
      }
      // Nothing in the ladder parsed: surface the real parser message.
      try {
        await mermaid.render(createMermaidId(), chart);
      } catch (err) {
        lastError = err;
      }
      if (!cancelled) setFailure(describeFailure(lastError, chart));
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, effectiveTheme, fitToContainer]);

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
      style={background ? { backgroundColor: background } : undefined}
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
      {failure ? (
        <div className={styles.error}>
          <p className={styles.errorTitle}>This diagram could not be rendered</p>
          <details className={styles.errorDetails}>
            <summary>Show the diagram source</summary>
            <pre className={styles.errorSource}>{failure.source}</pre>
          </details>
          <p className={styles.errorMessage}>{failure.message}</p>
        </div>
      ) : (
        <div ref={diagramRef} className={styles.diagram} style={transformStyle} />
      )}
    </div>
  );
}