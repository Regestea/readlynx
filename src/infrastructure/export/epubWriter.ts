import { zipSync } from "fflate";
import { uniformMargins } from "../../shared/document/pageGeometry";
import { isRtlDominant } from "../../shared/document/direction";
import { scaleHtmlFontSizes, scaledBaseFontSize } from "./fontScale";
import { highlightBodyCode, EPUB_CODE_BLOCK_CSS } from "./epubHighlight";
import {
  codeThemeCss,
  documentPalette,
  resolveDocumentMode,
} from "./exportTheme";
import type { ExportThemeOptions } from "./exportTheme";
import { katexCssForExport } from "./katexExportCss";
import type { EpubFile, EpubMetadata } from "./types";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const NS_XHTML = "http://www.w3.org/1999/xhtml";
const NS_EPUB = "http://www.idpf.org/2007/ops";
const NS_DC = "http://purl.org/dc/elements/1.1/";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * XHTML only permits the five predefined XML entities plus numeric character
 * references. The DOM serializer emits a named `&nbsp;` for non-breaking
 * spaces, and raw HTML blocks may carry `&copy;`, `&hellip;`, etc., which
 * strict readers reject with "Entity 'nbsp' not defined". This rewrites every
 * named entity into its numeric form (`&nbsp;` → `&#160;`).
 */
const XML_PREDEFINED_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);
const HTML_ENTITY_RE = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]+));/g;

let entityProbe: HTMLTextAreaElement | null = null;

function normalizeNamedEntities(html: string): string {
  return html.replace(HTML_ENTITY_RE, (match, dec: string, hex: string, name: string): string => {
    if (dec !== undefined || hex !== undefined) return match;
    if (XML_PREDEFINED_ENTITIES.has(name)) return match;
    entityProbe = entityProbe ?? document.createElement("textarea");
    entityProbe.innerHTML = `&${name};`;
    const decoded = entityProbe.value;
    if (!decoded || decoded === `&${name};`) return `&amp;${name};`;
    return `&#x${decoded.codePointAt(0)!.toString(16)};`;
  });
}

function makeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function extractFirstHeading(html: string): string {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match) return "";
  return match[1].replace(/<[^>]+>/g, "").trim();
}

/**
 * XHTML requires void elements (hr, br, img, …) to be self-closed. Lexical's
 * DOM serializer emits them via HTML serialization (`<hr>`, `<img src="…">`),
 * which strict EPUB readers reject as XML errors. Attribute values are matched
 * as quoted strings so `>` inside an attribute (e.g. an SVG data URL) is safe.
 */
const VOID_ELEMENT_RE =
  /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi;

function selfCloseVoidElements(html: string): string {
  return html.replace(VOID_ELEMENT_RE, (match, tag: string, attrs: string) => {
    if (attrs.trimEnd().endsWith("/")) return match;
    return `<${tag}${attrs} />`;
  });
}

/** Splits the body HTML into chapters at top-level <h1> boundaries. */
function splitChapters(bodyHtml: string): string[] {
  const chunks: string[] = [];
  const h1Re = /<h1[ >]/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = h1Re.exec(bodyHtml)) !== null) {
    chunks.push(bodyHtml.slice(last, match.index));
    last = match.index;
  }
  chunks.push(bodyHtml.slice(last));

  const preamble = chunks.shift();
  const chapters = chunks.filter((chunk) => chunk.trim().length > 0);
  if (preamble && preamble.trim().length > 0) chapters.unshift(preamble);
  if (chapters.length === 0) chapters.push(bodyHtml || "");
  return chapters;
}

/** Dominant text direction of an HTML fragment, for document-level `dir`. */
function chapterDirection(html: string): "rtl" | "ltr" {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return isRtlDominant(doc.body.textContent ?? "") ? "rtl" : "ltr";
}

/** Book content CSS. Every colour reads a `--rl-*` variable emitted on `body`
 *  by `bookCss()`, so the same sheet works for the light and dark templates
 *  (and for custom colours whose luminance flips the mode). */
const BOOK_CSS_BASE = `
h1, h2, h3, h4, h5, h6 { line-height: 1.3; }
p { margin: 0 0 0.9em; }
ul, ol { margin: 0 0 0.9em; }
blockquote { margin: 0.9em 0; padding: 0.2em 1em; border-inline-start: 3px solid var(--rl-quote-border); color: var(--rl-muted); }
code { font-family: var(--rl-code-family, monospace); font-size: 0.9em; }
pre { font-family: var(--rl-code-family, monospace); white-space: pre-wrap; margin: 0 0 0.9em; }
table { border-collapse: collapse; margin: 0.9em 0; width: 100%; }
th, td { border: 1px solid var(--rl-rule); padding: 0.3em 0.6em; text-align: start; }
th { background: var(--rl-table-head); }
img { max-width: 100%; }
/* Mermaid diagrams: a pre-rendered picture, kept whole and centred so a
   flowchart never splits across an epub page break. */
figure.rl-diagram { margin: 0.9em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure.rl-diagram img { max-width: 100%; height: auto; }
a { color: var(--rl-accent); }
aside[data-callout-tone] { margin: 0.9em 0; padding: 0.5em 1em; background: var(--rl-callout-bg); border-inline-start: 3px solid var(--rl-accent); }
section[data-block-kind="insight"] { margin: 0.9em 0; padding: 0.5em 1em; background: var(--rl-block-bg); }
`;

/** Body CSS built from the export theme options (light/white by default). */
function bookCss(options: ExportThemeOptions = {}): string {
  const m = options.margins ?? uniformMargins(12.7);
  const baseFontSize = scaledBaseFontSize(options.fontSizeScalePct, 16);
  const mode = resolveDocumentMode(options.template, options.backgroundColor);
  const palette = documentPalette(mode);
  const ink = options.textColor || palette["--rl-ink"];
  const paper = options.backgroundColor || palette["--rl-paper"];
  const paletteVars = [
    ...Object.entries(palette)
      .filter(([name]) => name !== "--rl-ink" && name !== "--rl-paper")
      .map(([name, value]) => `${name}: ${value};`),
    `--rl-ink: ${ink};`,
    `--rl-paper: ${paper};`,
    options.codeFontFamily ? `--rl-code-family: ${options.codeFontFamily};` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bodyProps = [
    options.fontFamily ? `font-family: ${options.fontFamily}` : "font-family: serif",
    ...(baseFontSize ? [`font-size: ${baseFontSize}`] : []),
    `color: ${ink}`,
    `background-color: ${paper}`,
    "line-height: 1.6",
    "margin: 0",
  ].join("; ");
  return `@page { margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
body { ${bodyProps} }
body { ${paletteVars} }
${BOOK_CSS_BASE}
${katexCssForExport()}`;
}

/**
 * Builds the EPUB 3 container files for a document.
 *
 * Source-agnostic: it takes the semantic HTML body the caller produced (from
 * the Lexical editor, or from a translated book) and turns it into a valid
 * EPUB 3 package — chapters split at `<h1>`, a nav document, an NCX fallback
 * for older readers, and a themed stylesheet. Nothing here knows where the
 * HTML came from.
 */
export function buildEpubFiles(
  bodyHtml: string,
  metadata: EpubMetadata = {},
  options: ExportThemeOptions = {},
  coverImage?: string,
): EpubFile[] {
  const title = metadata.title?.trim() || "Untitled Book";
  const author = metadata.author?.trim() || "Unknown Author";
  const language = metadata.language?.trim() || "en";
  const uid = metadata.identifier?.trim() || `urn:uuid:${makeUuid()}`;

  const chapters = splitChapters(
    normalizeNamedEntities(
      selfCloseVoidElements(
        highlightBodyCode(scaleHtmlFontSizes(bodyHtml, options.fontSizeScalePct)),
      ),
    ),
  );
  const bookDir = chapterDirection(bodyHtml);
  const chapterTitles = chapters.map(
    (chapter, i) => extractFirstHeading(chapter) || (chapters.length > 1 ? `Chapter ${i + 1}` : title),
  );

  const files: EpubFile[] = [];

  files.push({ path: "mimetype", mime: "text/plain", content: "application/epub+zip" });

  files.push({
    path: "META-INF/container.xml",
    mime: "application/xml",
    content: `${XML_DECL}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  });

  const chapterHrefs = chapters.map((_, i) => `chapter-${i + 1}.xhtml`);

  const hasCover = Boolean(coverImage);
  const coverHref = "cover.xhtml";
  const titleHref = "title.xhtml";
  // Reading order starts with a front page (the cover image, or a title page
  // when the book has no cover) so the Table of Contents is the second page.
  const frontHref = hasCover ? coverHref : titleHref;

  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    `    <item id="highlight-css" href="highlight.css" media-type="text/css"/>`,
    ...(hasCover
      ? [`    <item id="cover" href="${coverHref}" media-type="application/xhtml+xml" properties="cover-image"/>`]
      : [`    <item id="title" href="${titleHref}" media-type="application/xhtml+xml"/>`]),
    ...chapterHrefs.map(
      (href) =>
        `    <item id="${href.replace(".xhtml", "")}" href="${href}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");

  const spine = [
    `    <itemref idref="${frontHref.replace(".xhtml", "")}"/>`,
    `    <itemref idref="nav"/>`,
    ...chapterHrefs.map((href) => `    <itemref idref="${href.replace(".xhtml", "")}"/>`),
  ].join("\n");

  files.push({
    path: "OEBPS/content.opf",
    mime: "application/oebps-package+xml",
    content: `${XML_DECL}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="${NS_DC}">
    <dc:identifier id="uid">${xmlEscape(uid)}</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>${xmlEscape(language)}</dc:language>
    <dc:creator>${xmlEscape(author)}</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`,
  });

  const navItems = chapters
    .map(
      (_, i) =>
        `      <li><a href="${chapterHrefs[i]}">${xmlEscape(chapterTitles[i])}</a></li>`,
    )
    .join("\n");

  files.push({
    path: "OEBPS/nav.xhtml",
    mime: "application/xhtml+xml",
    content: `${XML_DECL}
<!DOCTYPE html>
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_EPUB}" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}" dir="${bookDir}">
  <head>
    <title>${xmlEscape(title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
${navItems}
      </ol>
    </nav>
  </body>
</html>`,
  });

  const navPoints = chapters
    .map(
      (_, i) =>
        `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(chapterTitles[i])}</text></navLabel>
      <content src="${chapterHrefs[i]}"/>
    </navPoint>`,
    )
    .join("\n");

  files.push({
    path: "OEBPS/toc.ncx",
    mime: "application/x-dtbncx+xml",
    content: `${XML_DECL}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(uid)}"/>
  </head>
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <docAuthor><text>${xmlEscape(author)}</text></docAuthor>
  <navMap>
${navPoints}
  </navMap>
</ncx>`,
  });

  if (hasCover && coverImage) {
    files.push({
      path: `OEBPS/${coverHref}`,
      mime: "application/xhtml+xml",
      content: `${XML_DECL}
<!DOCTYPE html>
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_EPUB}" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}">
  <head>
    <title>${xmlEscape(title)}</title>
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
      img { width: 100%; height: 100%; object-fit: cover; }
    </style>
  </head>
  <body>
    <img src="${xmlEscape(coverImage)}" alt="Cover" />
  </body>
</html>`,
    });
  } else {
    files.push({
      path: `OEBPS/${titleHref}`,
      mime: "application/xhtml+xml",
      content: `${XML_DECL}
<!DOCTYPE html>
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_EPUB}" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}" dir="${bookDir}">
  <head>
    <title>${xmlEscape(title)}</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      body { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 10%; }
      h1 { margin: 0 0 0.4em; font-size: 1.8em; }
      p.author { margin: 0; color: #555; font-size: 1.05em; }
    </style>
  </head>
  <body>
    <h1>${xmlEscape(title)}</h1>
    ${author && author !== "Unknown Author" ? `<p class="author">${xmlEscape(author)}</p>` : ""}
  </body>
</html>`,
    });
  }

  chapters.forEach((chapter, i) => {
    const dir = chapterDirection(chapter);
    files.push({
      path: `OEBPS/${chapterHrefs[i]}`,
      mime: "application/xhtml+xml",
      content: `${XML_DECL}
<!DOCTYPE html>
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_EPUB}" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}" dir="${dir}">
  <head>
    <title>${xmlEscape(chapterTitles[i])}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
    <link rel="stylesheet" type="text/css" href="highlight.css"/>
  </head>
  <body>
    <section epub:type="chapter" dir="${dir}">
${chapter}
    </section>
  </body>
</html>`,
    });
  });

  files.push({
    path: "OEBPS/style.css",
    mime: "text/css",
    content: bookCss(options),
  });

  files.push({
    path: "OEBPS/highlight.css",
    mime: "text/css",
    content: `${codeThemeCss(options.codeTheme, resolveDocumentMode(options.template, options.backgroundColor))}
${EPUB_CODE_BLOCK_CSS}`,
  });

  return files;
}

/**
 * Packs the EPUB container files into a single `.epub` archive.
 *
 * Per the EPUB 3 spec, the `mimetype` file must be the first entry and stored
 * uncompressed, which is what EPUB readers rely on for file sniffing.
 */
export function zipEpubFiles(files: EpubFile[]): Blob {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [index, file] of files.entries()) {
    const bytes = new TextEncoder().encode(file.content);
    entries[file.path] =
      index === 0 && file.path === "mimetype" ? [bytes, { level: 0 }] : bytes;
  }
  return new Blob([zipSync(entries)], { type: "application/epub+zip" });
}
