/**
 * Colour maths for the picker's own canvas and hex field. Pure functions, no
 * DOM and no React, so the canvas painting, the text field and the swatch
 * rows all agree on what a hex string means.
 *
 * Deliberately separate from the reader's `epubViewer/colorMath`: that one
 * parses arbitrary CSS colours and reasons about contrast, this one only
 * speaks `#rrggbb` and the hue/saturation/value space the two handles move in.
 */

/** Fallback used whenever a value cannot be read as a colour. */
export const FALLBACK_HEX = "#000000";

/** A complete `#rrggbb` colour. */
export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** A `#` plus up to six hex digits — what the text field may hold mid-typing. */
export const HEX_PARTIAL_RE = /^#[0-9a-f]{0,6}$/i;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** Hue in degrees, 0..360. */
  h: number;
  /** Saturation, 0..1. */
  s: number;
  /** Value, 0..1. */
  v: number;
}

export function isCompleteHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/** The value if it is a complete colour, otherwise the fallback. Used
 *  everywhere a colour is handed to a `style` prop, so an empty or half-typed
 *  string can never reach CSS. */
export function normalizeHex(value: string, fallback: string = FALLBACK_HEX): string {
  return HEX_RE.test(value.trim()) ? value.trim() : fallback;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { r: 0, g: 0, b: 0 };
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const value = (1 << 24) | (r << 16) | (g << 8) | b;
  return `#${value.toString(16).slice(1)}`;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = ((gg - bb) / delta + (gg < bb ? 6 : 0)) * 60;
    else if (max === gg) h = ((bb - rr) / delta + 2) * 60;
    else h = ((rr - gg) / delta + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/** Hue, saturation and value of a colour, for positioning the two handles. */
export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

/** `"#1e293b"` -> `"RGB(30, 41, 59)"`, for the readout beside the field. */
export function formatRgbLabel(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `RGB(${r}, ${g}, ${b})`;
}