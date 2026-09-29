import { AlignmentType } from "docx";
import {
  codeBlockPalette,
  codeThemeCss,
  documentPalette,
  resolveDocumentMode,
} from "./exportTheme";
import type { ExportCodeThemeId, ExportThemeOptions } from "./exportTheme";

/**
 * The parts of the export theme a Word file has to be told explicitly.
 *
 * CSS resolves a font stack, a translucent tint and a Highlight.js palette at
 * paint time; OOXML has no equivalent, so every one of them becomes a concrete
 * value here. Both DOCX writers resolve the theme through this module, which is
 * why they agree on what "the dark code theme" or "the book font" means in a
 * Word file.
 */

const GENERIC_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy"]);

/** Word wants a 6-digit hex colour without the leading `#`. */
export function parseWordColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const match = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (match) return match[1].toUpperCase();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    return short[1]
      .split("")
      .map((part) => part + part)
      .join("")
      .toUpperCase();
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(trimmed);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return undefined;
}

/** First family name from a CSS font-family list, or the fallback. */
export function concreteFont(value: string | undefined, fallback: string): string {
  const first = value
    ?.split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return first && !GENERIC_FAMILIES.has(first.toLowerCase()) ? first : fallback;
}

export type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];

/**
 * Encodes a paragraph's visual alignment for the `w:jc` element.
 *
 * Word mirrors `left`/`right` on a `w:bidi` paragraph: writing `jc="right"`
 * puts an RTL paragraph against the LEFT margin, and `jc="left"` puts it
 * against the right one. Verified against Word itself — it writes `jc="right"`
 * when a user left-aligns an RTL paragraph, and no `w:jc` at all when one is
 * right-aligned. `center` and `justify` are symmetric and pass through, and a
 * left-to-right paragraph is absolute, so only the RTL asymmetric cases are
 * translated here.
 */
export function justificationFor(
  visual: DocxAlignment | undefined,
  rtl: boolean,
): DocxAlignment | undefined {
  if (!rtl) return visual;
  if (visual === AlignmentType.LEFT) return AlignmentType.RIGHT;
  if (visual === AlignmentType.RIGHT) return undefined;
  return visual;
}

/** A CSS custom property's hex value as a Word colour. */
function paletteColor(palette: Record<string, string>, name: string, fallback: string): string {
  return (palette[name] ?? fallback).replace("#", "").toUpperCase();
}

export interface DocxPalette {
  /** Body text family. */
  bodyFont: string;
  /** Monospace family for code blocks. */
  codeFont: string;
  /** Body text colour, when the author picked one. */
  textColor: string | undefined;
  /** Surface and ink of code blocks, from the chosen Highlight.js theme. */
  codeSurface: string;
  codeInk: string;
  /** Inline-code surface. Word cannot shade with a translucent colour, so the
   *  theme's tint is approximated by a solid one. */
  inlineCodeSurface: string;
  /** Highlight.js token class -> Word colour, read from the theme's own
   *  stylesheet so a Word file matches the theme the reader picked. */
  tokenColors: Record<string, string>;
  tableHead: string;
  rule: string;
  accent: string;
  muted: string;
}

const DEFAULT_CODE_FONT = "Consolas";

/** The monospace family the export picked for code blocks. */
export function codeFontFromTheme(value: string | undefined): string {
  return concreteFont(value, DEFAULT_CODE_FONT);
}

/**
 * Highlight.js token colours, read straight out of the theme stylesheet.
 *
 * The PDF hands the whole sheet to the browser, so a token is coloured by a
 * CSS rule nobody has to read. A Word file needs the number, and the theme's own
 * stylesheet is where it is written — so parsing it keeps the two in step for
 * every theme, present and future, instead of duplicating six palettes here.
 */
export function tokenColorsFromTheme(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const color = /(?<![-\w])color\s*:\s*(#[0-9a-f]{3,8})/i.exec(rule[2])?.[1];
    if (!color) continue;
    const hex = color.slice(1).toUpperCase();
    const value = hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((part) => part + part)
          .join("")
      : hex.slice(0, 6);
    for (const selector of rule[1].split(",")) {
      const name = selector.trim().replace(/^\./, "");
      if (name.startsWith("hljs-")) colors[name] = value;
    }
  }
  return colors;
}

export function resolveDocxPalette(options: ExportThemeOptions): DocxPalette {
  const mode = resolveDocumentMode(options.template, options.backgroundColor);
  const palette = documentPalette(mode);
  const code = codeBlockPalette(options.codeTheme, mode);
  return {
    bodyFont: concreteFont(options.fontFamily, "Calibri"),
    codeFont: codeFontFromTheme(options.codeFontFamily),
    textColor: parseWordColor(options.textColor),
    codeSurface: code.bg.slice(1).toUpperCase(),
    codeInk: code.ink.slice(1).toUpperCase(),
    inlineCodeSurface: code.bg.slice(1).toUpperCase(),
    tokenColors: tokenColorsFromTheme(
      codeThemeCss(options.codeTheme as ExportCodeThemeId, mode),
    ),
    tableHead: paletteColor(palette, "--rl-table-head", "#EEF0F3"),
    rule: paletteColor(palette, "--rl-rule", "#D9DCE1"),
    accent: paletteColor(palette, "--rl-accent", "#2F6B57"),
    muted: paletteColor(palette, "--rl-muted", "#5D6673"),
  };
}
