import { createElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { safeUrlTransform } from "../../../components/markdown/safeUrl";
import { REHYPE_LINE_BREAKS_ONLY } from "../../../components/markdown/rehypeSafeHtml";
import { escapeHtmlInMarkdown, textOfChildren } from "../../../components/markdown/markdownSource";
import { getTextDir, textAlignForDir } from "../../../shared/document/direction";
import { mermaidToPngDataUrl } from "./mermaidImage";
import { buildEpubFiles, zipEpubFiles } from "../../../infrastructure/export/epubWriter";
import type { ExportContent } from "../../../components/export/types";

/**
 * Turns a book's cached translation into the shared export contract.
 *
 * The translation is stored as Markdown, so the body HTML is produced with the
 * *same* remark/rehype pipeline the reader uses (GFM tables, task lists,
 * math) and rendered statically — no React interactivity, no reader chrome,
 * just the semantic HTML the export writers expect.
 *
 * The whole book is rendered once, up front (see `renderTranslatedBook`), so
 * the dialog can re-paginate its preview and swap formats without re-parsing
 * every chapter each time.
 */

/** One page or chapter of the book, as it appears in the export. */
export interface TranslatedUnit {
  /** Page number (PDF) or chapter key (EPUB/Markdown) — stable React key. */
  id: string;
  /** `chapter` renders an `<h1>` heading above the content; `page` does not
   *  (a heading on every page of a book would be noise). */
  kind: "chapter" | "page";
  title: string;
  markdown: string;
}

/** Stable plugin lists: react-markdown re-parses on identity change.
 *
 *  The same chain the reader uses for AI-written content: the source is
 *  escaped first (so HTML/JSX snippets stay text) and only `<br>` is parsed
 *  back, which is what a table cell needs to break a line. Identical plugins
 *  mean an export can never contain markup the reader would have refused. */
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [...REHYPE_LINE_BREAKS_ONLY, rehypeKatex];

/** Direction attributes for one rendered block, mirroring the reader's
 *  per-block analysis so a Persian paragraph aligns the same way in the app
 *  and in the exported file. Reads the whole child tree, not just a direct
 *  string — a table cell mixing Persian text with `<br>` or `<strong>`
 *  arrives as an array and would otherwise get no direction at all. */
function dirAttrs(children: ReactNode): Record<string, unknown> {
  const text = textOfChildren(children);
  const dir = text ? getTextDir(text) : undefined;
  const textAlign = textAlignForDir(dir);
  return {
    ...(dir ? { dir } : {}),
    ...(textAlign ? { style: { textAlign } } : {}),
  };
}

/** Minimal component map: plain semantic elements, plus the direction
 *  attributes. The reader's map is deliberately not reused — it wires up
 *  zoom, fullscreen and Mermaid rendering that mean nothing in a static file,
 *  and several of its components need a live DOM. Code blocks stay plain here;
 *  the export pipeline's highlight pass adds the colours afterwards.
 *
 *  The one exception is Mermaid: an exported document cannot run it, so those
 *  fences are swapped for the pre-rendered image (see `mermaidImage.ts`). */
function blockDir(tag: string) {
  return ({ children, ...props }: { children?: ReactNode; node?: unknown }) => {
    const { node, ...rest } = props;
    void node;
    return createElement(tag, { ...rest, ...dirAttrs(children) }, children);
  };
}

/** Diagrams that were rasterized, keyed by the exact fence body. Keying on
 *  the source rather than a counter means a diagram repeated in the book is
 *  rendered once and reused. */
type MermaidImages = ReadonlyMap<string, string>;

function exportComponents(mermaidImages: MermaidImages): Components {
  return {
    h1: blockDir("h1"),
    h2: blockDir("h2"),
    h3: blockDir("h3"),
    h4: blockDir("h4"),
    h5: blockDir("h5"),
    h6: blockDir("h6"),
    p: blockDir("p"),
    ul: blockDir("ul"),
    ol: blockDir("ol"),
    li: blockDir("li"),
    blockquote: blockDir("blockquote"),
    td: blockDir("td"),
    th: blockDir("th"),
    pre: ({ children, ...props }) => {
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement(child)) {
        const { className, children: inner } = child.props as {
          className?: unknown;
          children?: ReactNode;
        };
        if (typeof className === "string" && className.includes("language-mermaid")) {
          const dataUrl = mermaidImages.get(textOfChildren(inner).trim());
          if (dataUrl) {
            return createElement(
              "figure",
              { className: "rl-diagram" },
              createElement("img", { src: dataUrl, alt: "Diagram" }),
            );
          }
        }
      }
      return createElement("pre", props, children);
    },
    /** Code keeps its exact characters; only the fence class is preserved so
     *  the Mermaid swap above and the highlight pass can both recognise the
     *  language. */
    code: ({ children, className, ...props }: { children?: ReactNode; className?: string; node?: unknown }) => {
      const { node, ...rest } = props;
      void node;
      return createElement("code", { ...rest, ...(className ? { className } : {}) }, children);
    },
  };
}

/** Minimal escaping for the titles interpolated by hand. */
function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The bodies of every ```mermaid fence in `markdown`, in document order.
 *
 *  The fence contents are read straight out of the string that will be parsed,
 *  so the key matches the text the `pre` component sees and the map cannot
 *  drift out of sync with the rendered tree. `escapeHtmlInMarkdown` leaves
 *  fenced blocks alone, so Mermaid's `-->` and `<-->` survive intact. */
function mermaidFences(markdown: string): string[] {
  const found: string[] = [];
  let open = false;
  let body: string[] = [];
  for (const line of markdown.split("\n")) {
    const fence = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)/.exec(line);
    if (!open) {
      if (fence?.[2].toLowerCase() === "mermaid") {
        open = true;
        body = [];
      }
      continue;
    }
    if (fence && fence[2] === "") {
      found.push(body.join("\n").trim());
      open = false;
      continue;
    }
    body.push(line);
  }
  if (open) found.push(body.join("\n").trim());
  return found;
}

/** Rasterizes every distinct Mermaid diagram in the book. A diagram that
 *  cannot be rendered is simply absent from the map, and its code block stays
 *  in the document as readable text. */
async function renderMermaidImages(units: TranslatedUnit[]): Promise<MermaidImages> {
  const sources = new Set<string>();
  for (const unit of units) {
    for (const source of mermaidFences(escapeHtmlInMarkdown(unit.markdown))) {
      if (source) sources.add(source);
    }
  }
  if (sources.size === 0) return new Map();

  const images = new Map<string, string>();
  // Sequential on purpose: mermaid keeps global render state, and one book
  // rarely holds enough diagrams for the wall-clock to matter.
  for (const source of sources) {
    const dataUrl = await mermaidToPngDataUrl(source);
    if (dataUrl) images.set(source, dataUrl);
  }
  return images;
}

/** Renders one unit to a body fragment. `escapeHtmlInMarkdown` keeps an
 *  AI-written HTML/JSX snippet as literal text while letting `<br>` through
 *  as a real line break — the same treatment the reader gives it. */
function unitHtml(
  unit: TranslatedUnit,
  bookDir: "rtl" | "ltr",
  mermaidImages: MermaidImages,
): string {
  // react-markdown wraps its output in a single element; strip it so the
  // units sit side by side in the flow instead of nested.
  const content = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={exportComponents(mermaidImages)}
      urlTransform={safeUrlTransform}
    >
      {escapeHtmlInMarkdown(unit.markdown)}
    </ReactMarkdown>,
  )
    .replace(/^<div>|<\/div>$/g, "")
    .trim();
  if (unit.kind === "page") return content;
  return `<h1 dir="${bookDir}">${escapeText(unit.title)}</h1>\n${content}`;
}

/**
 * The protocol the app serves stored translation images under. Word and EPUB
 * containers can only reference bytes, so these have to become data URLs
 * before the document leaves the app.
 */
const TRANSLATION_IMAGE_RE = /readlynx-translation-image:\/\/[^"')\s]+/g;

/** Resolves stored translation images to data URLs, so the exported file
 *  actually shows the pictures instead of a dangling protocol link. Images
 *  that cannot be read are left as they are. */
async function inlineTranslationImages(html: string): Promise<string> {
  const urls = [...new Set(html.match(TRANSLATION_IMAGE_RE) ?? [])];
  if (urls.length === 0) return html;
  const resolved = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const blob = await response.blob();
        if (blob.size === 0) return;
        const dataUrl = await new Promise<string | null>((done) => {
          const reader = new FileReader();
          reader.onload = () => done(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => done(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) resolved.set(url, dataUrl);
      } catch {
        // Leave the protocol URL; the writer drops it if it cannot use it.
      }
    }),
  );
  if (resolved.size === 0) return html;
  return html.replace(TRANSLATION_IMAGE_RE, (url) => resolved.get(url) ?? url);
}

/**
 * Renders the whole book to a single semantic HTML body, with its images
 * resolved. Runs once when the export dialog is opened; every writer and the
 * dialog's preview then share the same string.
 *
 * The body is wrapped in a `dir` container matching the book's dominant
 * language, so page-level layout (margins, list bullets, table column order)
 * follows the text, and each block additionally carries its own `dir` for
 * mixed-direction content.
 */
export async function renderTranslatedBook(units: TranslatedUnit[]): Promise<string> {
  const bookDir = getTextDir(units.map((unit) => unit.markdown).join(" ")) ?? "ltr";
  const mermaidImages = await renderMermaidImages(units);
  const body = units
    .map((unit) => unitHtml(unit, bookDir, mermaidImages))
    .filter(Boolean)
    .join("\n\n");
  const inlined = await inlineTranslationImages(body);
  return `<div dir="${bookDir}">${inlined}</div>`;
}

/** Export content for a translated book, ready for the shared dialog.
 *
 * All four formats are offered: PDF and HTML come from the body HTML, while
 * DOCX and EPUB are packaged by the shared writers in
 * `infrastructure/export`, which take the same HTML. Chapter breaks are left
 * to the pagination pass, which needs to lay the document out before it can
 * tell whether a break is worth a page. */
export function translatedBookContent(label: string, bodyHtml: string): ExportContent {
  return {
    label,
    formats: ["pdf", "docx", "html", "epub"],
    bodyHtml: () => bodyHtml,
    epub: (theme, cover) =>
      zipEpubFiles(buildEpubFiles(bodyHtml, { title: label }, theme, cover)).arrayBuffer(),
  };
}
