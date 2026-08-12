import type { PagedFlow } from "pagedjs";
import { Previewer } from "pagedjs";
import { PAGE_FORMATS } from "../../shared/document/pageGeometry";
import { fontScaleFactor } from "./fontScale";
import type { PdfExportOptions } from "./types";
import {
  codeBlockPalette,
  documentPalette,
  resolveDocumentMode,
} from "./exportTheme";

/**
 * Typescript-safe wrapper around the Paged.js `Previewer`.
 *
 * Responsibilities:
 *   * run the CSS pagination engine on a semantic HTML fragment,
 *   * collect everything needed to reproduce the result in a standalone
 *     document (generated @page rules, fonts, images),
 *   * clean up the layout host between runs.
 *
 * Nothing here measures elements or inserts page breaks into the editor —
 * Paged.js interprets the `@page`, `break-*` and `page` counter declarations.
 */

const PAGED_STYLE_ATTR = "data-pagedjs-inserted-styles";

export interface PaginateResult {
  pages: HTMLElement[];
  pageCount: number;
  flow: PagedFlow;
  container: HTMLElement;
}

export class PaginationService {
  private previewer: Previewer | null = null;
  private host: HTMLDivElement | null = null;

  /** Layout `bodyHtml` into physical pages inside `target` (or a private hidden host). */
  async paginate(
    bodyHtml: string,
    cssTexts: string[],
    target?: HTMLElement,
    settings?: { maxChars?: number },
  ): Promise<PaginateResult> {
    this.dispose();

    const host = target ?? this.ensureHost();
    // Always force a fresh engine per run: pagedjs keeps mutable global state
    // (chunker/polisher/handlers) that should not leak between documents.
    this.previewer = new Previewer(settings);

    try {
      // pagedjs's polisher treats bare string entries as URLs to fetch, so CSS
      // is passed as `{ href: text }` objects.
      const stylesheets = cssTexts.map((text, index) => ({
        [`readlynx-print-${index}.css`]: text,
      }));
      const flow = await this.previewer.preview(bodyHtml, stylesheets, host);
      const container = PaginationService.getPagesContainer(host);
      const pages = Array.from(container.querySelectorAll<HTMLElement>(".pagedjs_page"));
      return { pages, pageCount: pages.length, flow, container };
    } catch (error) {
      this.dispose();
      throw new Error("Paged.js pagination failed", { cause: error });
    }
  }

  /** Largest container that holds every rendered page of `from`. */
  static getPagesContainer(from: HTMLElement): HTMLElement {
    return (from.querySelector(".pagedjs_pages") ?? from) as HTMLElement;
  }

  /** Remove the hidden host, injected pagedjs styles and any previewer instance. */
  dispose(): void {
    if (this.previewer) {
      try {
        this.previewer.polisher?.destroy();
      } catch {
        // ignore; the engine may not have run yet
      }
      this.previewer = null;
    }
    if (this.host && this.host.isConnected) {
      this.host.remove();
    }
    this.host = null;
  }

  private ensureHost(): HTMLDivElement {
    if (this.host && this.host.isConnected) {
      return this.host;
    }
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;";
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-readlynx-paged-host", "");
    document.body.appendChild(host);
    this.host = host;
    return host;
  }
}

/**
 * Collect the generated styles Paged.js injected into `document.head` during
 * the last pagination run — the standalone export replays them to keep the
 * layout pixel-identical.
 */
export function collectPagedStyles(): string {
  const styles: string[] = [];
  for (const el of document.querySelectorAll<HTMLStyleElement>(`style[${PAGED_STYLE_ATTR}]`)) {
    const text = el.textContent ?? "";
    if (text.trim()) {
      styles.push(text);
    }
  }
  return styles.join("\n");
}

/**
 * Gather all `@font-face` rules registered in the live document, with font
 * URLs absolutised against the current page so the standalone export (which
 * renders from a `data:` URL) can still load the fonts.
 */
export function collectFontFaces(): string {
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled) {
      continue;
    }
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin rulesheet — the export re-declares the fonts instead
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        faces.push(absolutizeFontFace(rule.cssText));
      }
    }
  }
  return faces.join("\n");
}

function absolutizeFontFace(cssText: string): string {
  return cssText.replace(/url\((["']?)([^"')]+)\1\)/g, (match, quote: string, url: string) => {
    if (/^(data:|https?:|blob:)/i.test(url)) {
      return match;
    }
    try {
      return `url(${quote}${new URL(url, document.baseURI).href}${quote})`;
    } catch {
      return match;
    }
  });
}

/**
 * Snapshot the `--pagedjs-*` custom properties the engine resolved on `:root`
 * so the standalone document replays the exact geometry even if the engine's
 * own generated sheet differs between runs.
 */
export function collectRootVariables(): string {
  const computed = getComputedStyle(document.documentElement);
  const declarations: string[] = [];
  for (const name of ROOT_VARIABLES) {
    const value = computed.getPropertyValue(name);
    if (value) {
      declarations.push(`  ${name}: ${value};`);
    }
  }
  return declarations.length > 0 ? `:root {\n${declarations.join("\n")}\n}` : "";
}

const ROOT_VARIABLES = [
  "--pagedjs-width",
  "--pagedjs-height",
  "--pagedjs-width-right",
  "--pagedjs-height-right",
  "--pagedjs-width-left",
  "--pagedjs-height-left",
  "--pagedjs-pagebox-width",
  "--pagedjs-pagebox-height",
  "--pagedjs-margin-top",
  "--pagedjs-margin-right",
  "--pagedjs-margin-bottom",
  "--pagedjs-margin-left",
  "--pagedjs-padding-top",
  "--pagedjs-padding-right",
  "--pagedjs-padding-bottom",
  "--pagedjs-padding-left",
  "--pagedjs-border-top",
  "--pagedjs-border-right",
  "--pagedjs-border-bottom",
  "--pagedjs-border-left",
  "--pagedjs-footnotes-height",
] as const;

/** Convert non-`data:`/`http(s):` image sources (blob:, object:) to data URLs. */
export async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || /^(data:|https?:)/i.test(src) || /^readlynx-([a-z]+):/i.test(src)) {
        return;
      }
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        img.setAttribute("src", await blobToDataUrl(blob));
      } catch {
        // keep the original URL; the renderer shows its fallback.
      }
    }),
  );
}

/** Serialise a blob into a `data:` URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/** Build the theme override block used by PrintStyles.css (page-scoped). */
export function themeVariables(options: PdfExportOptions): string {
  // Effective surface mode drives every derived palette value (muted, accent,
  // rules, code surface…) so both the ready-made templates and arbitrary
  // custom colours produce a coherent light or dark page.
  const mode = resolveDocumentMode(options.template, options.backgroundColor);
  const palette = documentPalette(mode);

  const decls: string[] = [];

  // Emit BOTH the CSS variables (headings etc. read `var(--rl-ink)`) and a
  // literal declaration on the page itself. The literal value wins over the
  // defaults in PrintStyles.css even if Paged.js re-inserts the sheets in an
  // unexpected order; the variable keeps inner rules aligned.
  decls.push(
    `--rl-ink: ${palette["--rl-ink"]};`,
    `color: ${palette["--rl-ink"]};`,
    `--rl-paper: ${palette["--rl-paper"]};`,
    `background-color: ${palette["--rl-paper"]};`,
  );
  for (const [name, value] of Object.entries(palette)) {
    if (name === "--rl-ink" || name === "--rl-paper") continue;
    decls.push(`${name}: ${value};`);
  }
  if (options.textColor) {
    decls.push(`--rl-ink: ${options.textColor};`, `color: ${options.textColor};`);
  }
  if (options.backgroundColor) {
    decls.push(
      `--rl-paper: ${options.backgroundColor};`,
      `background-color: ${options.backgroundColor};`,
    );
  }

  // Code block surface + font.
  const code = codeBlockPalette(options.codeTheme, mode);
  decls.push(
    `--rl-code-bg: ${code.bg};`,
    `--rl-code-border: ${code.border};`,
    `--rl-code-ink: ${code.ink};`,
    `--rl-inline-code-bg: ${code.inlineBg};`,
  );
  if (options.codeFontFamily) {
    decls.push(`--rl-code-family: ${options.codeFontFamily};`);
  }
  if (options.fontFamily) {
    decls.push(`--rl-font-family: ${options.fontFamily};`, `font-family: ${options.fontFamily};`);
  }
  if (options.fontSizeScalePct) {
    const size = Number((15 * fontScaleFactor(options.fontSizeScalePct)).toFixed(2));
    decls.push(`--rl-font-size: ${size}px;`, `font-size: ${size}px;`);
  }
  if (options.lineHeight) {
    decls.push(`--rl-line-height: ${options.lineHeight};`, `line-height: ${options.lineHeight};`);
  }
  if (decls.length === 0) {
    return "";
  }
  // Double the class so the override always beats the `--rl-*` defaults in
  // PrintStyles.css (0,2,0 vs 0,1,0) no matter which sheet lands later in the
  // cascade — Paged.js re-inserts every sheet as its own <style> tag.
  return `.pagedjs_page.pagedjs_page { ${decls.join(" ")} }`;
}

/**
 * The dynamic print CSS handed to Paged.js: exact @page geometry plus the
 * running margins (headers / footers / page numbers).
 */
export function buildPrintCss(options: PdfExportOptions): string {
  const { pageFormat, margins } = options;
  const { cssSize } = PAGE_FORMATS[pageFormat];

  const slot = (position: string, value?: string) => {
    if (!value) return "";
    // `counter(page)` / `counter(pages)` must NOT be quoted or they render as
    // literal text instead of the running page number.
    const content = /^counter\([a-z]+\)$/i.test(value.trim()) ? value.trim() : `"${value}"`;
    return `\n  @${position} { content: ${content}; }`;
  };

  const headerFragments =
    options.headerLeft || options.headerCenter || options.headerRight
      ? `@page {${slot("top-left", options.headerLeft)}${slot("top-center", options.headerCenter)}${slot("top-right", options.headerRight)}\n}`
      : "";

  const footerFragments =
    options.showPageNumbers || options.footerLeft || options.footerCenter || options.footerRight
      ? `@page {${slot("bottom-left", options.footerLeft)}${slot(
          "bottom-center",
          options.footerCenter || (options.showPageNumbers ? "counter(page)" : ""),
        )}${slot("bottom-right", options.footerRight)}\n}`
      : "";

  return [
    `@page { size: ${cssSize}; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm; }`,
    headerFragments,
    footerFragments,
    options.chapterBreaks === false
      ? ""
      : "h1.rl-chapter-start { break-before: page !important; page-break-before: always !important; }",
  ]
    .filter(Boolean)
    .join("\n");
}