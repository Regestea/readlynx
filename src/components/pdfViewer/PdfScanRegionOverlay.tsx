import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Check, Maximize, X } from "lucide-react";
import { Button } from "../ui/Button/Button";
import {
  MIN_SCAN_REGION_FRACTION,
  normalizeScanRegion,
} from "../../features/reading/translation/pdfScan";
import type { PdfRegionBox } from "../../features/reading/translation/pdfRegions";
import type { PdfScanRegion } from "../../features/reading/translation/pdfScan";
import styles from "./PdfScanRegionOverlay.module.css";

/** Which part of the rect a gesture grabs: the whole rect to move it, or one of
 *  its eight edges / corners. No free-draw mode — the frame always starts at a
 *  known size and is trimmed from there, so every edge stays where it was left. */
type DragMode = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const HANDLES: Array<{ mode: Exclude<DragMode, "move">; className: string }> = [
  { mode: "nw", className: styles.handleNw },
  { mode: "n", className: styles.handleN },
  { mode: "ne", className: styles.handleNe },
  { mode: "e", className: styles.handleE },
  { mode: "se", className: styles.handleSe },
  { mode: "s", className: styles.handleS },
  { mode: "sw", className: styles.handleSw },
  { mode: "w", className: styles.handleW },
];

/** Where a book with no saved region starts, so the frame is visible and the
 *  first gesture is a trim rather than a guess. */
const WHOLE_PAGE_BOX: PdfRegionBox = { x: 0, y: 0, w: 1, h: 1 };

const clamp01 = (value: number): number => Math.min(Math.max(0, value), 1);
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Applies a drag to the rect it started from. Edges are clamped independently,
 * so dragging a corner past the far edge stops at `min` instead of inverting the
 * rect, and `min` matches the smallest size the save would accept anyway. */
function resizeBox(origin: PdfRegionBox, mode: DragMode, dx: number, dy: number): PdfRegionBox {
  let { x, y, w, h } = origin;
  if (mode === "move") {
    x = clamp(x + dx, 0, 1 - w);
    y = clamp(y + dy, 0, 1 - h);
    return { x, y, w, h };
  }
  const min = MIN_SCAN_REGION_FRACTION;
  const right = x + w;
  const bottom = y + h;
  if (mode.includes("n")) {
    const top = clamp(y + dy, 0, bottom - min);
    y = top;
    h = bottom - top;
  }
  if (mode.includes("s")) {
    h = clamp(h + dy, min, 1 - y);
  }
  if (mode.includes("w")) {
    const left = clamp(x + dx, 0, right - min);
    x = left;
    w = right - left;
  }
  if (mode.includes("e")) {
    w = clamp(w + dx, min, 1 - x);
  }
  return { x, y, w, h };
}

interface PdfScanRegionOverlayProps {
  /** Region stored for the book (null = whole page). Seeds the frame so an
   *  edit tweaks the old one. */
  region: PdfScanRegion | null;
  /** Saves the region (null = whole page) and closes the overlay. */
  onCommit: (region: PdfScanRegion | null) => void;
  /** Closes without saving. */
  onClose: () => void;
}

/**
 * Lets the user trim the page down to the part that is scanned or sent to AI
 * vision. The frame starts at the whole page (or the region's last saved size)
 * and is cut with its eight handles, so the running head, footer and page
 * numbers being excluded stay visible while the margins are dimmed.
 */
export function PdfScanRegionOverlay({
  region,
  onCommit,
  onClose,
}: PdfScanRegionOverlayProps) {
  const [box, setBox] = useState<PdfRegionBox>(() =>
    region ? { x: region.x, y: region.y, w: region.w, h: region.h } : WHOLE_PAGE_BOX,
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  /** Pointer position at gesture start plus the rect it started from; null
   *  when no gesture is running. */
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; origin: PdfRegionBox } | null>(
    null,
  );

  /** Gesture position as a page fraction, read live so the rect stays correct
   *  through zoom and window resizes. */
  const pointAt = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const startDrag = useCallback(
    (mode: DragMode, event: ReactPointerEvent) => {
      event.stopPropagation();
      event.preventDefault();
      const start = pointAt(event.clientX, event.clientY);
      dragRef.current = { mode, startX: start.x, startY: start.y, origin: box };
    },
    [box, pointAt],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = pointAt(event.clientX, event.clientY);
      setBox(resizeBox(drag.origin, drag.mode, point.x - drag.startX, point.y - drag.startY));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [pointAt]);

  /** Escape discards, Enter saves — the usual dialog contract, so the choice
   *  can be made without reaching for the mouse. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if (event.key === "Enter") {
        event.stopPropagation();
        onCommit(normalizeScanRegion(box));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [box, onClose, onCommit]);

  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const trimmed: string[] = [];
  if (box.y > 0.005) trimmed.push(`top ${percent(box.y)}`);
  if (box.y + box.h < 0.995) trimmed.push(`bottom ${percent(1 - box.y - box.h)}`);
  if (box.x > 0.005) trimmed.push(`left ${percent(box.x)}`);
  if (box.x + box.w < 0.995) trimmed.push(`right ${percent(1 - box.x - box.w)}`);
  const isWholePage = trimmed.length === 0;

  return (
    <div className={styles.overlay} role="dialog" aria-label="Scan region">
      <div ref={surfaceRef} className={styles.surface}>
        <div
          className={styles.cutout}
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
          onPointerDown={(event) => startDrag("move", event)}
        >
          {HANDLES.map((handle) => (
            <span
              key={handle.mode}
              className={`${styles.handle} ${handle.className}`}
              onPointerDown={(event) => startDrag(handle.mode, event)}
            />
          ))}
        </div>
      </div>

      {/* Parked in the top corner: the handles sit at the edges of the
          selection, so this is never under the pointer mid-drag. */}
      <div className={styles.actions}>
        <Button
          variant="icon"
          className={styles.action}
          onClick={() => setBox(WHOLE_PAGE_BOX)}
          disabled={isWholePage}
          aria-label="Scan the whole page"
          title="Back to the whole page"
        >
          <Maximize size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>
        <Button
          variant="icon"
          className={styles.action}
          onClick={onClose}
          aria-label="Cancel and close"
          title="Cancel and close"
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>
        <Button
          variant="icon"
          className={`${styles.action} ${styles.actionPrimary}`}
          onClick={() => onCommit(normalizeScanRegion(box))}
          aria-label="Save the scan region"
          title="Save this region for the whole book"
        >
          <Check size={18} strokeWidth={2.2} aria-hidden="true" />
        </Button>
      </div>

      {/* Feedback only — never clickable, so it can never swallow a drag that
          started over it. */}
      <span className={styles.hint} role="status">
        {isWholePage
          ? "The whole page is scanned — drag an edge or corner to cut the header off"
          : `Only the frame is scanned — trimmed ${trimmed.join(", ")}`}
      </span>
    </div>
  );
}