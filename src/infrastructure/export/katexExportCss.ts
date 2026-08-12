import katexCssRaw from "katex/dist/katex.min.css?raw";

/**
 * KaTeX stylesheets for exported documents (HTML/PDF/EPUB).
 *
 * `katex.min.css` references its fonts with relative `url(fonts/…)` paths,
 * which break inside standalone exported files. The woff2 glyphs are therefore
 * embedded as base64 data URIs so exported math renders identically to the
 * editor. Only the modern woff2 files are kept — each @font-face lists
 * woff2/woff/ttf sources, and data-URI embedding of every format would
 * triple the payload for no rendering benefit.
 */
const KATEX_FONT_GLOBS = import.meta.glob<string>("/node_modules/katex/dist/fonts/*.woff2", {
  query: "?inline",
  import: "default",
  eager: true,
});

const KATEX_FONT_BY_NAME = new Map<string, string>();
for (const [path, dataUri] of Object.entries(KATEX_FONT_GLOBS)) {
  const name = path.split("/").pop();
  if (name) KATEX_FONT_BY_NAME.set(name, dataUri);
}

function stripFontFormats(css: string): string {
  return css.replace(
    /url\(fonts\/KaTeX_[^)]+\.woff\)\s*format\("woff"\),?|url\(fonts\/KaTeX_[^)]+\.ttf\)\s*format\("truetype"\),?/g,
    "",
  );
}

/** KaTeX CSS with fonts inlined as data URIs, ready to drop into export HTML. */
export function katexCssForExport(): string {
  let css = stripFontFormats(katexCssRaw);
  for (const [name, dataUri] of KATEX_FONT_BY_NAME) {
    css = css.replaceAll(`url(fonts/${name})`, `url(${dataUri})`);
  }
  return css;
}
