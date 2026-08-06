import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import { zipSync } from "fflate";
import type { EpubFile, EpubMetadata, ExportThemeOptions } from "../types";
import { isRtlDominant } from "../utils/direction";
import { highlightBodyCode, HIGHLIGHT_THEME_CSS } from "./epubHighlight";

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

const BOOK_CSS_BASE = `
body { line-height: 1.6; margin: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; }
p { margin: 0 0 0.9em; }
ul, ol { margin: 0 0 0.9em; }
blockquote { margin: 0.9em 0; padding: 0.2em 1em; border-inline-start: 3px solid #ccc; color: #555; }
code { font-family: monospace; font-size: 0.9em; }
pre { white-space: pre-wrap; background: #f4f2ec; padding: 0.8em; }
table { border-collapse: collapse; margin: 0.9em 0; width: 100%; }
th, td { border: 1px solid #bbb; padding: 0.3em 0.6em; text-align: start; }
th { background: #eee; }
img { max-width: 100%; }
a { color: #7a4a21; }
aside[data-callout-tone] { margin: 0.9em 0; padding: 0.5em 1em; background: #f0ede6; border-inline-start: 3px solid #8c6248; }
section[data-block-kind="insight"] { margin: 0.9em 0; padding: 0.5em 1em; background: #f7f3ea; }
`;

/** Body CSS built from the export theme options (serif/white by default). */
function bookCss(options: ExportThemeOptions = {}): string {
  const bodyProps = [
    options.fontFamily ? `font-family: ${options.fontFamily}` : "font-family: serif",
    ...(options.fontSize ? [`font-size: ${options.fontSize}`] : []),
    ...(options.textColor ? [`color: ${options.textColor}`] : []),
    ...(options.backgroundColor ? [`background-color: ${options.backgroundColor}`] : []),
    "line-height: 1.6",
    "margin: 0",
  ].join("; ");
  return `@page { margin: ${options.marginMm ?? 12.7}mm; }
body { ${bodyProps}; }
${BOOK_CSS_BASE}`;
}

export function exportEpub(
  editor: LexicalEditor,
  metadata: EpubMetadata = {},
  options: ExportThemeOptions = {},
  coverImage?: string,
): EpubFile[] {
  const title = metadata.title?.trim() || "Untitled Book";
  const author = metadata.author?.trim() || "Unknown Author";
  const language = metadata.language?.trim() || "en";
  const uid = metadata.identifier?.trim() || `urn:uuid:${makeUuid()}`;

  const bodyHtml = editor.read(() => $generateHtmlFromNodes(editor));
  const chapters = splitChapters(selfCloseVoidElements(highlightBodyCode(bodyHtml)));
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

  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    `    <item id="highlight-css" href="highlight.css" media-type="text/css"/>`,
    ...(hasCover
      ? [`    <item id="cover" href="${coverHref}" media-type="application/xhtml+xml" properties="cover-image"/>`]
      : []),
    ...chapterHrefs.map(
      (href) =>
        `    <item id="${href.replace(".xhtml", "")}" href="${href}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");

  const spine = [
    `    <itemref idref="nav"/>`,
    ...(hasCover ? [`    <itemref idref="cover"/>`] : []),
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
    content: HIGHLIGHT_THEME_CSS,
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
