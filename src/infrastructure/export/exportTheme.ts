import githubCss from "highlight.js/styles/github.min.css?raw";
import githubDarkCss from "highlight.js/styles/github-dark.min.css?raw";
import monokaiCss from "highlight.js/styles/monokai.min.css?raw";
import nightOwlCss from "highlight.js/styles/night-owl.min.css?raw";
import vsCss from "highlight.js/styles/vs.min.css?raw";
import nordCss from "highlight.js/styles/nord.min.css?raw";

/**
 * Export theming for PDF and EPUB.
 *
 * A document has an overall look — the "template" (none / modern light /
 * modern dark) — which decides the page surface and the derived palette
 * (muted text, accent, rules, table heads, callouts). Code blocks are themed
 * independently: the author can pick a highlight theme (light, dark or a
 * named theme) and a monospace font, independent of the document look.
 *
 * Every palette value is emitted as a CSS custom property so the print
 * stylesheet (PrintStyles.css) and the EPUB book CSS can read one set of
 * `--rl-*` variables in both light and dark modes.
 */

export type ExportTemplateId = "none" | "light" | "dark";
export type ExportCodeThemeId =
  | "auto"
  | "light"
  | "dark"
  | "monokai"
  | "night-owl"
  | "vs"
  | "nord";

export type ThemeMode = "light" | "dark";
export type CodeThemeKind = ThemeMode;

/** Document template presets (the "None" template means: keep the plain look). */
export interface ExportTemplatePreset {
  id: Exclude<ExportTemplateId, "none">;
  name: string;
  desc: string;
  textColor: string;
  backgroundColor: string;
  marginMm: number;
}

export const EXPORT_TEMPLATES: ExportTemplatePreset[] = [
  {
    id: "light",
    name: "Light Modern",
    desc: "Clean light look",
    textColor: "#20242e",
    backgroundColor: "#ffffff",
    marginMm: 10,
  },
  {
    id: "dark",
    name: "Dark Modern",
    desc: "Elegant dark look",
    textColor: "#e8eaf0",
    backgroundColor: "#14161c",
    marginMm: 10,
  },
];

/** Code-block highlight themes offered in the export dialog. */
export interface ExportCodeThemeOption {
  value: ExportCodeThemeId;
  label: string;
  kind: CodeThemeKind;
}

export const EXPORT_CODE_THEME_OPTIONS: ExportCodeThemeOption[] = [
  { value: "auto", label: "Auto (follow document)", kind: "light" },
  { value: "light", label: "Light", kind: "light" },
  { value: "dark", label: "Dark", kind: "dark" },
  { value: "monokai", label: "Monokai", kind: "dark" },
  { value: "night-owl", label: "Night Owl", kind: "dark" },
  { value: "vs", label: "VS Code", kind: "light" },
  { value: "nord", label: "Nord", kind: "dark" },
];

/** Monospace families for code blocks in exported documents. */
export interface CodeFontOption {
  value: string;
  label: string;
}

export const CODE_FONT_OPTIONS: CodeFontOption[] = [
  { value: "", label: "Default" },
  { value: "Consolas, 'Courier New', monospace", label: "Consolas" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
  { value: "'JetBrains Mono', Consolas, monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', Consolas, monospace", label: "Fira Code" },
  { value: "Menlo, Consolas, monospace", label: "Menlo" },
  { value: "'Source Code Pro', Consolas, monospace", label: "Source Code Pro" },
  { value: "'SF Mono', Consolas, monospace", label: "SF Mono" },
  { value: "'Cascadia Mono', Consolas, monospace", label: "Cascadia Mono" },
  { value: "'DejaVu Sans Mono', Consolas, monospace", label: "DejaVu Sans Mono" },
  { value: "'Ubuntu Mono', Consolas, monospace", label: "Ubuntu Mono" },
];

/** Dark/light luminance test for arbitrary (custom) page colours. */
export function isDarkColor(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 130;
}

/**
 * Effective document surface mode: the template wins when given, otherwise
 * fall back on the luminance of the page background (so custom colours theme
 * consistently too).
 */
export function resolveDocumentMode(
  template?: ExportTemplateId,
  backgroundColor?: string,
): ThemeMode {
  if (template === "dark") return "dark";
  if (template === "light") return "light";
  return backgroundColor && isDarkColor(backgroundColor) ? "dark" : "light";
}

/** Resolve the "auto" code theme against the document mode. */
export function resolveCodeTheme(
  id: ExportCodeThemeId | undefined,
  mode: ThemeMode,
): Exclude<ExportCodeThemeId, "auto"> {
  if (id && id !== "auto") return id;
  return mode === "dark" ? "dark" : "light";
}

/** Document palette (custom properties) for a light/dark page surface. */
export type Palette = Record<string, string>;

export function documentPalette(mode: ThemeMode): Palette {
  return mode === "dark"
    ? {
        "--rl-paper": "#14161c",
        "--rl-ink": "#e8eaf0",
        "--rl-muted": "#9aa3b1",
        "--rl-accent": "#7fc4a8",
        "--rl-rule": "#333845",
        "--rl-table-head": "#23262f",
        "--rl-callout-bg": "rgba(127, 196, 168, 0.12)",
        "--rl-block-bg": "#1b1e26",
        "--rl-quote-border": "rgba(127, 196, 168, 0.4)",
      }
    : {
        "--rl-paper": "#ffffff",
        "--rl-ink": "#20242e",
        "--rl-muted": "#5d6673",
        "--rl-accent": "#2f6b57",
        "--rl-rule": "#d9dce1",
        "--rl-table-head": "#eef0f3",
        "--rl-callout-bg": "rgba(47, 107, 87, 0.08)",
        "--rl-block-bg": "#f7f8fa",
        "--rl-quote-border": "rgba(47, 107, 87, 0.35)",
      };
}

/** Surface colours for a specific code-block theme (bg/border/base ink). */
export interface CodeBlockPalette {
  bg: string;
  border: string;
  ink: string;
  inlineBg: string;
}

const CODE_BLOCK_PALETTES: Record<Exclude<ExportCodeThemeId, "auto">, CodeBlockPalette> = {
  light: {
    bg: "#f6f8fa",
    border: "#dde1e6",
    ink: "#24292f",
    inlineBg: "rgba(36, 41, 47, 0.08)",
  },
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    ink: "#c9d1d9",
    inlineBg: "rgba(201, 209, 217, 0.12)",
  },
  monokai: {
    bg: "#272822",
    border: "#3e3d32",
    ink: "#f8f8f2",
    inlineBg: "rgba(248, 248, 242, 0.12)",
  },
  "night-owl": {
    bg: "#011627",
    border: "#1d3b53",
    ink: "#d6deeb",
    inlineBg: "rgba(214, 222, 235, 0.12)",
  },
  vs: {
    bg: "#ffffff",
    border: "#e2e2e2",
    ink: "#24292f",
    inlineBg: "rgba(36, 41, 47, 0.08)",
  },
  nord: {
    bg: "#2e3440",
    border: "#3b4252",
    ink: "#d8dee9",
    inlineBg: "rgba(216, 222, 233, 0.12)",
  },
};

export function codeBlockPalette(
  id: ExportCodeThemeId | undefined,
  mode: ThemeMode,
): CodeBlockPalette {
  return CODE_BLOCK_PALETTES[resolveCodeTheme(id, mode)];
}

const CODE_THEME_CSS: Record<Exclude<ExportCodeThemeId, "auto">, string> = {
  light: githubCss,
  dark: githubDarkCss,
  monokai: monokaiCss,
  "night-owl": nightOwlCss,
  vs: vsCss,
  nord: nordCss,
};

/** Highlight.js token stylesheet for the chosen code theme. */
export function codeThemeCss(
  id: ExportCodeThemeId | undefined,
  mode: ThemeMode,
): string {
  return CODE_THEME_CSS[resolveCodeTheme(id, mode)];
}