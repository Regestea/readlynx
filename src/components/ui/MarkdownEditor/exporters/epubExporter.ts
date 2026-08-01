import type { LexicalEditor } from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import type { EpubFile, EpubMetadata } from "../types";

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

const BOOK_CSS = `
@page { margin: 1.25em; }
body { font-family: serif; line-height: 1.6; margin: 0; }
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

export function exportEpub(editor: LexicalEditor, metadata: EpubMetadata = {}): EpubFile[] {
  const title = metadata.title?.trim() || "Untitled Book";
  const author = metadata.author?.trim() || "Unknown Author";
  const language = metadata.language?.trim() || "en";
  const uid = metadata.identifier?.trim() || `urn:uuid:${makeUuid()}`;

  const bodyHtml = $generateHtmlFromNodes(editor);
  const chapters = splitChapters(bodyHtml);
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

  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    ...chapterHrefs.map(
      (href) =>
        `    <item id="${href.replace(".xhtml", "")}" href="${href}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");

  const spine = [
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
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_EPUB}" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}">
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

  chapters.forEach((chapter, i) => {
    files.push({
      path: `OEBPS/${chapterHrefs[i]}`,
      mime: "application/xhtml+xml",
      content: `${XML_DECL}
<!DOCTYPE html>
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_EPUB}" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}">
  <head>
    <title>${xmlEscape(chapterTitles[i])}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <section epub:type="chapter">
${chapter}
    </section>
  </body>
</html>`,
    });
  });

  files.push({
    path: "OEBPS/style.css",
    mime: "text/css",
    content: BOOK_CSS,
  });

  return files;
}
