import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  HEX_PARTIAL_RE,
  formatRgbLabel,
  hexToHsv,
  hsvToRgb,
  normalizeHex,
  rgbToHex,
} from "./colorMath";
import styles from "./ColorArea.module.css";

interface ColorAreaProps {
  /** Current colour as `#rrggbb`. Held by the caller — the area is fully
   *  controlled, so a host can bind it straight to a setting or to a draft. */
  value: string;
  onChange: (value: string) => void;
  /** Shows the live RGB readout beside the hex field. */
  showReadout?: boolean;
  className?: string;
}

/** Canvas backing sizes. The SV square keeps a 4:3 box, the hue bar is thin;
 *  both are scaled by CSS to whatever width the panel has. */
const SV_WIDTH = 280;
const SV_HEIGHT = 210;
const HUE_WIDTH = 280;
const HUE_HEIGHT = 14;
const HANDLE_RADIUS = 7;

/**
 * The colour picker proper: a saturation/value square, a hue bar, a hex field
 * and a live preview. It carries no label, no trigger and no presets — the
 * curated reading swatches stay with the panel that hosts this area, so the
 * easy-on-the-eyes choices are one click away and never buried under a slider.
 */
export function ColorArea({ value, onChange, showReadout = true, className = "" }: ColorAreaProps) {
  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  /** Which handle is held down, or null. State rather than a ref: the drag
   *  listeners are registered from an effect, which needs a value to depend
   *  on, and this only changes twice per drag. */
  const [dragging, setDragging] = useState<"sv" | "hue" | null>(null);

  const valid = normalizeHex(value);
  const hsv = hexToHsv(valid);

  /** The colour's position, readable by the drag handler without closing over
   *  a stale copy of it: the listener is registered once when the drag starts
   *  and lives through every step, and each step changes the colour. */
  const latest = useRef(hsv);
  useEffect(() => {
    latest.current = hsv;
  }, [hsv]);

  const drawSvSquare = useCallback((h: number, s: number, v: number) => {
    const canvas = svRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, w, height);

    // A white-to-hue gradient across, then a transparent-to-black one down:
    // together they are every colour at that hue, which is cheaper than
    // filling SV_WIDTH * SV_HEIGHT pixels one by one.
    const across = ctx.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, "#ffffff");
    across.addColorStop(1, rgbToHex(hsvToRgb(h, 1, 1)));
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, height);

    const down = ctx.createLinearGradient(0, 0, 0, height);
    down.addColorStop(0, "rgba(0,0,0,0)");
    down.addColorStop(1, "#000000");
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, w, height);

    const x = s * w;
    const y = (1 - v) * height;
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS - 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }, []);

  const drawHueBar = useCallback((h: number) => {
    const canvas = hueRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const height = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let degree = 0; degree <= 360; degree += 30) {
      grad.addColorStop(degree / 360, rgbToHex(hsvToRgb(degree, 1, 1)));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, height);

    const x = (h / 360) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      drawSvSquare(hsv.h, hsv.s, hsv.v);
      drawHueBar(hsv.h);
    });
    return () => cancelAnimationFrame(frame);
  }, [hsv.h, hsv.s, hsv.v, drawSvSquare, drawHueBar]);

  /** Reads a pointer position as saturation/value, clamped to the canvas. */
  const svFromEvent = useCallback((clientX: number, clientY: number) => {
    const canvas = svRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
    return { s: x / rect.width, v: 1 - y / rect.height };
  }, []);

  const hueFromEvent = useCallback((clientX: number) => {
    const canvas = hueRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * 360;
  }, []);

  /** A colour at a point in the SV square: the held hue with that s/v. */
  const applySv = useCallback(
    (h: number, clientX: number, clientY: number) => {
      const point = svFromEvent(clientX, clientY);
      if (!point) return;
      onChange(rgbToHex(hsvToRgb(h, point.s, point.v)));
    },
    [onChange, svFromEvent],
  );

  /** A colour at a point on the hue bar: that hue with the held s/v. */
  const applyHue = useCallback(
    (clientX: number) => {
      const h = hueFromEvent(clientX);
      if (h === null) return;
      const { s, v } = latest.current;
      onChange(rgbToHex(hsvToRgb(h, s, v)));
    },
    [onChange, hueFromEvent],
  );

  /** One gesture: the pointer listeners exist only while a handle is held,
   *  instead of for the lifetime of the component. */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const { h } = latest.current;
      if (dragging === "sv") applySv(h, event.clientX, event.clientY);
      else applyHue(event.clientX);
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, applySv, applyHue]);

  const handleSvPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    // Only the primary button starts a drag.
    if (event.button !== 0) return;
    event.preventDefault();
    applySv(hsv.h, event.clientX, event.clientY);
    setDragging("sv");
  };

  const handleHuePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    applyHue(event.clientX);
    setDragging("hue");
  };

  /** Accepts anything the field can hold mid-typing (`#`, `#1e2`) and reports
   *  it upward; a half-typed value paints as the fallback colour but is not
   *  corrected, so typing `#f0…` is not fought by the component. */
  const handleHexChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (HEX_PARTIAL_RE.test(next)) onChange(next);
  };

  return (
    <div className={[styles.area, className].filter(Boolean).join(" ")}>
      <canvas
        ref={svRef}
        width={SV_WIDTH}
        height={SV_HEIGHT}
        className={styles.svSquare}
        onPointerDown={handleSvPointerDown}
      />
      <canvas
        ref={hueRef}
        width={HUE_WIDTH}
        height={HUE_HEIGHT}
        className={styles.hueBar}
        onPointerDown={handleHuePointerDown}
      />
      <div className={styles.previewRow}>
        <div className={styles.preview} style={{ backgroundColor: valid }} />
        <input
          type="text"
          className={styles.hexField}
          value={value}
          onChange={handleHexChange}
          placeholder="#000000"
          maxLength={7}
          spellCheck={false}
          aria-label="Hex color"
        />
        {showReadout && <span className={styles.rgbLabel}>{formatRgbLabel(valid)}</span>}
      </div>
    </div>
  );
}