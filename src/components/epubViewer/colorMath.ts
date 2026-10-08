/**
 * Colour maths used to re-theme EPUB content: CSS colour parsing, alpha
 * compositing, WCAG contrast and the two repairs the reader needs —
 * readable text on a given surface, and a surface that fits the page
 * polarity. Deliberately DOM-free so the rules stay verifiable on their own.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Luminance at which black and white text score the same contrast — the
 *  boundary between a "light" and a "dark" surface. */
const POLARITY_LUMINANCE = 0.179;

/** How far apart two colours must sit, in 8-bit sRGB levels, before the reader
 *  considers a surface or a rule visible at all. Unlike a contrast ratio this
 *  is perceptually flat: four levels apart is imperceptible whether the
 *  colours sit near white or near black. */
export const MIN_VISIBLE_DELTA = 4;

/** Perceptual distance between two colours in 8-bit sRGB levels. */
export function channelDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/** Enough of the CSS named colours to cover what books actually use. */
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  orange: "#ffa500",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  dimgray: "#696969",
  dimgrey: "#696969",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  gainsboro: "#dcdcdc",
  whitesmoke: "#f5f5f5",
  snow: "#fffafa",
  ivory: "#fffff0",
  beige: "#f5f5dc",
  khaki: "#f0e68c",
  wheat: "#f5deb3",
  tan: "#d2b48c",
  peru: "#cd853f",
  chocolate: "#d2691e",
  sienna: "#a0522d",
  brown: "#a52a2a",
  firebrick: "#b22222",
  darkred: "#8b0000",
  crimson: "#dc143c",
  tomato: "#ff6347",
  salmon: "#fa8072",
  goldenrod: "#daa520",
  steelblue: "#4682b4",
  royalblue: "#4169e1",
  seagreen: "#2e8b57",
  forestgreen: "#228b22",
  indigo: "#4b0082",
  lavender: "#e6e6fa",
  aliceblue: "#f0f8ff",
  mistyrose: "#ffe4e1",
  honeydew: "#f0fff0",
  transparent: "#00000000",
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function parseHexColor(raw: string): Rgba | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(raw);
  if (!match) return null;
  const digits = match[1];
  const size = digits.length <= 4 ? 1 : 2;
  if (digits.length !== size * 3 && digits.length !== size * 4) return null;
  const expand = (value: string) => (value.length === 1 ? value + value : value);
  const parts: number[] = [];
  for (let index = 0; index < digits.length; index += size) {
    parts.push(parseInt(expand(digits.slice(index, index + size)), 16));
  }
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return {
    r: parts[0] ?? 0,
    g: parts[1] ?? 0,
    b: parts[2] ?? 0,
    a: parts.length === 4 ? (parts[3] ?? 255) / 255 : 1,
  };
}

/** Splits `210, 50%, 40% / 0.4` into its channels and its optional alpha. */
function splitColorArgs(body: string): { parts: string[]; alpha: string | null } {
  const [main, alpha = ""] = body.split("/");
  const parts = main.trim().split(/[\s,]+/).filter(Boolean);
  return { parts, alpha: alpha.trim() || null };
}

/** Splits a colour body for `rgb()`/`hsl()`, accepting both the modern
 *  `rgb(1 2 3 / 0.4)` and the legacy `rgba(1, 2, 3, 0.4)` spellings. */
function splitChannels(body: string): { parts: string[]; alpha: string | null } {
  const split = splitColorArgs(body);
  if (split.alpha === null && split.parts.length === 4) {
    return { parts: split.parts.slice(0, 3), alpha: split.parts[3] ?? null };
  }
  return split;
}

/** `50%` or `128` on a 0…255 scale. `none` counts as zero. */
function channel(token: string, scale: number): number {
  const value = token.trim();
  if (value === "none") return 0;
  if (value.endsWith("%")) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? clamp((percent / 100) * scale, 0, scale) : NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, scale) : NaN;
}

/** `color(srgb …)` components are 0…1, not 0…255. */
function unit(token: string): number {
  const value = token.trim();
  if (value === "none") return 0;
  const number = value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) * 255 : NaN;
}

function alphaChannel(token: string | null): number {
  if (token === null) return 1;
  const value = token.trim();
  if (value === "none") return 0;
  if (value.endsWith("%")) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? clamp(percent / 100, 0, 1) : 1;
  }
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : 1;
}

function parseRgbFunction(body: string): Rgba | null {
  const { parts, alpha } = splitChannels(body);
  if (parts.length < 3) return null;
  const r = channel(parts[0], 255);
  const g = channel(parts[1], 255);
  const b = channel(parts[2], 255);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b, a: alphaChannel(alpha) };
}

function parseHslFunction(body: string): Rgba | null {
  const { parts, alpha } = splitChannels(body);
  if (parts.length < 3) return null;
  const hue = Number(parts[0].replace(/deg$/i, ""));
  const saturation = channel(parts[1], 1);
  const lightness = channel(parts[2], 1);
  if (!Number.isFinite(hue) || !Number.isFinite(saturation) || !Number.isFinite(lightness)) {
    return null;
  }
  const rgb = hslToRgb({ h: ((hue % 360) + 360) % 360, s: saturation, l: lightness });
  return { ...rgb, a: alphaChannel(alpha) };
}

/** `color(srgb 1 0.5 0 / 0.4)` — what `getComputedStyle` returns for a
 *  `color-mix()`; other colour spaces are left untouched on purpose. */
function parseColorFunction(body: string): Rgba | null {
  const { parts, alpha } = splitColorArgs(body);
  if (parts.length < 4 || parts[0].trim() !== "srgb") return null;
  const r = unit(parts[1]);
  const g = unit(parts[2]);
  const b = unit(parts[3]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b, a: alphaChannel(alpha) };
}

/**
 * Parses the colour notations a book stylesheet can hand us. Returns null for
 * anything it does not understand (`lab()`, `oklch()`, gradients, …) so the
 * caller can leave those declarations alone instead of guessing.
 */
export function parseCssColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw || raw === "none" || raw === "currentcolor") return null;
  if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[raw];
  if (named) return parseHexColor(named);
  if (raw.startsWith("#")) return parseHexColor(raw);
  const call = /^([a-z-]+)\(([^()]*)\)$/.exec(raw);
  if (!call) return null;
  const [, name, body] = call;
  if (name === "rgb" || name === "rgba") return parseRgbFunction(body);
  if (name === "hsl" || name === "hsla") return parseHslFunction(body);
  if (name === "color") return parseColorFunction(body);
  return null;
}

/** Flattens a translucent colour onto an opaque backdrop. */
export function compositeOver(color: Rgba, background: Rgb): Rgb {
  if (color.a >= 1) return { r: color.r, g: color.g, b: color.b };
  if (color.a <= 0) return { r: background.r, g: background.g, b: background.b };
  return {
    r: Math.round(color.r * color.a + background.r * (1 - color.a)),
    g: Math.round(color.g * color.a + background.g * (1 - color.a)),
    b: Math.round(color.b * color.a + background.b * (1 - color.a)),
  };
}

/** Parses a CSS colour and flattens it onto white, so a translucent reader
 *  background can be used as an opaque base. */
export function opaqueColor(value: string | null | undefined): Rgb | null {
  const parsed = parseCssColor(value);
  return parsed ? compositeOver(parsed, WHITE) : null;
}

export function relativeLuminance(color: Rgb): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 2.1 contrast ratio (1…21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when light text wins over dark text on this surface. */
export function isLightSurface(color: Rgb): boolean {
  return relativeLuminance(color) >= POLARITY_LUMINANCE;
}

/** Convenience for CSS values the reader already holds (picked colours). */
export function isLightColorValue(value: string | null | undefined): boolean {
  const parsed = parseCssColor(value);
  if (!parsed) return true;
  return isLightSurface(compositeOver(parsed, WHITE));
}

export function mixColors(base: Rgb, toward: Rgb, amount: number): Rgb {
  const weight = clamp(amount, 0, 1);
  return {
    r: Math.round(base.r + (toward.r - base.r) * weight),
    g: Math.round(base.g + (toward.g - base.g) * weight),
    b: Math.round(base.b + (toward.b - base.b) * weight),
  };
}

/** How loud a colour is, independent of how light or dark it is (HSL
 *  saturation). Used to keep saturated publisher colours off long prose. */
export function chroma(color: Rgb): number {
  return rgbToHsl(color).s;
}

function round(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

/** `rgb(…)`, or `rgba(…)` when the colour is translucent. */
export function toCssColor(color: Rgba): string {
  const r = round(color.r);
  const g = round(color.g);
  const b = round(color.b);
  // `!(a < 1)` also treats a missing/NaN alpha as opaque.
  if (!(color.a < 1)) return `rgb(${r}, ${g}, ${b})`;
  const alpha = Math.round(clamp(color.a, 0, 1) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbToHsl(color: Rgb): Hsl {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / delta + 2) * 60;
  else h = ((r - g) / delta + 4) * 60;
  return { h, s, l };
}

function hslToRgb(hsl: Hsl): Rgb {
  const { h, s, l } = hsl;
  if (s <= 0) {
    const value = round(l * 255);
    return { r: value, g: value, b: value };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return { r: round((r1 + m) * 255), g: round((g1 + m) * 255), b: round((b1 + m) * 255) };
}

/** Binary-searches the lightness that first reaches `target` contrast while
 *  walking away from `start` towards `extreme`. Contrast is monotonic in
 *  lightness on one side of a surface, so the search converges on the
 *  *smallest* change that reads. Returns null when even the extreme misses. */
function searchLightness(
  hsl: Hsl,
  background: Rgb,
  target: number,
  extreme: number,
): Hsl | null {
  const start = clamp(hsl.l, 0, 1);
  const ratioAt = (lightness: number, saturation = hsl.s) =>
    contrastRatio(hslToRgb({ h: hsl.h, s: saturation, l: lightness }), background);
  if (ratioAt(start) >= target) return hsl;
  if (ratioAt(extreme) < target) return null;
  // `lo` always satisfies the target, `hi` never does: the answer is `lo`,
  // i.e. the smallest move away from the start that reads.
  let lo = extreme;
  let hi = start;
  for (let step = 0; step < 18; step += 1) {
    const mid = (lo + hi) / 2;
    if (ratioAt(mid) >= target) lo = mid;
    else hi = mid;
  }
  // Ease the saturation off as the colour travels towards black/white, where
  // a saturated hue turns garish — but never at the cost of the target.
  const moved = Math.abs(lo - start);
  const softened = hsl.s * (1 - 0.5 * Math.min(1, moved / 0.4));
  if (softened > 0 && hsl.s > 0 && ratioAt(lo, softened) >= target) {
    return { h: hsl.h, s: softened, l: lo };
  }
  return { h: hsl.h, s: hsl.s, l: lo };
}

/**
 * Returns a colour that reaches `target` contrast against `background`,
 * preferring the original hue (a red heading stays red, just darker on a
 * light page) and falling back to the reader's own text colour — then to
 * plain black/white — only when the book's colour cannot be saved.
 */
export function fixTextContrast(
  color: Rgba,
  background: Rgb,
  target: number,
  fallback: Rgb,
): Rgba {
  const base = compositeOver(color, background);
  if (contrastRatio(base, background) >= target) return color;
  const extreme = isLightSurface(background) ? 0 : 1;
  const repaired = searchLightness(rgbToHsl(base), background, target, extreme);
  if (repaired) return { ...hslToRgb(repaired), a: color.a };

  const fallbackBase = compositeOver({ ...fallback, a: 1 }, background);
  if (contrastRatio(fallbackBase, background) >= target) {
    return { ...fallbackBase, a: color.a };
  }
  const fallbackFixed = searchLightness(rgbToHsl(fallbackBase), background, target, extreme);
  const safe = fallbackFixed ? hslToRgb(fallbackFixed) : extreme < 0.5 ? BLACK : WHITE;
  return { ...safe, a: color.a };
}

export interface SurfaceRepair {
  color: Rgb;
  changed: boolean;
}

/**
 * The palette entry closest in hue to `color` (circular distance), i.e. the
 * curated ink meant for this family of colour. Neutral colours match the first
 * near-grey entry, which is exactly what they need.
 */
export function nearestHueInk(color: Rgb, palette: readonly Rgb[]): Rgb | null {
  if (palette.length === 0) return null;
  const hue = rgbToHsl(color).h;
  let best: Rgb | null = null;
  let bestDistance = Infinity;
  for (const ink of palette) {
    const inkHue = rgbToHsl(ink).h;
    const raw = Math.abs(inkHue - hue);
    const distance = Math.min(raw, 360 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ink;
    }
  }
  return best;
}

/**
 * Replaces a colour that is louder than the soft ink of its own hue family
 * with that ink's chroma, keeping the book's hue and the lightness it had
 * (so the page polarity never flips) and repairing the contrast afterwards.
 *
 * The palette therefore acts as a per-hue ceiling: `#f00` lands on the soft
 * red's chroma, a neon sky blue on the soft slate's, and a colour already at
 * or below its family's level is returned untouched. Returns the input colour
 * when the palette is empty.
 */
export function softenWithPalette(
  color: Rgba,
  background: Rgb,
  target: number,
  palette: readonly Rgb[],
): Rgba {
  const base = compositeOver(color, background);
  const ink = nearestHueInk(base, palette);
  if (!ink) return color;
  const from = rgbToHsl(base);
  const ceiling = rgbToHsl(ink).s;
  if (from.s <= ceiling + 0.02) return color;

  const candidate: Hsl = { h: from.h, s: ceiling, l: from.l };
  let result = hslToRgb(candidate);
  if (contrastRatio(result, background) < target) {
    const extreme = isLightSurface(background) ? 0 : 1;
    const repaired = searchLightness(candidate, background, target, extreme);
    if (repaired) result = hslToRgb(repaired);
  }
  return { ...result, a: color.a };
}

/**
 * Decides what a book-authored background should become on the reader's page:
 *
 * - untouched while it reads against the page, so deliberate publisher design
 *   (a dark callout on a light page, a subtle panel on a subtle page) survives;
 * - rebuilt as a tinted panel with the book's hue when it fights the page (the
 *   classic white box on a black page) or when it is indistinguishable from
 *   the page behind it.
 */
export function repairSurface(
  color: Rgba,
  background: Rgb,
  target: number,
): SurfaceRepair {
  const surface = compositeOver(color, background);
  const fightsPage = isLightSurface(surface) && !isLightSurface(background);
  if (!fightsPage && channelDistance(surface, background) >= MIN_VISIBLE_DELTA) {
    return { color: surface, changed: false };
  }

  const hsl = rgbToHsl(surface);
  const pageIsLight = isLightSurface(background);
  // Same lightness ladder as the page, the book's hue kept as an accent and
  // its saturation capped so a tinted panel never shouts.
  const tint: Hsl = { h: hsl.h, s: Math.min(hsl.s, 0.4), l: pageIsLight ? 1 : 0 };
  const far = pageIsLight ? 0 : 1;
  const ratioAt = (lightness: number) =>
    contrastRatio(hslToRgb({ ...tint, l: lightness }), background);
  if (ratioAt(far) < target) return { color: surface, changed: false };

  let lo = far;
  let hi = pageIsLight ? 1 : 0;
  for (let step = 0; step < 18; step += 1) {
    const mid = (lo + hi) / 2;
    if (ratioAt(mid) >= target) lo = mid;
    else hi = mid;
  }
  return { color: hslToRgb({ ...tint, l: lo }), changed: true };
}