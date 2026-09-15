import { createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { Braces, Maximize2, Minus, Minimize2, Palette, Plus } from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { Code } from "../ui/Code/Code";
import { Image } from "../ui/Image/Image";
import { Table } from "../ui/Table/Table";
import type { TableColumn } from "../ui/Table/Table";
import tableStyles from "../ui/Table/Table.module.css";
import { FontFamilySelect } from "../FontFamilySelect/FontFamilySelect";
import { ColorPickerPanel } from "../ui/ColorPickerPanel/ColorPickerPanel";
import { AiSelectionBubble } from "../AiSelectionBubble/AiSelectionBubble";
import { useReaderSettings } from "../../hooks/useReaderSettings.ts";
import type { MarkdownBlockTheme } from "../../hooks/useReaderSettings.ts";
import { getSelectionEndRect } from "../../shared/selection";
import { MermaidDiagram } from "./MermaidDiagram";
import { safeUrlTransform } from "./safeUrl";
import styles from "./Markdown.module.css";

interface BlockAppearance {
  codeTheme: MarkdownBlockTheme | null;
  diagramTheme: MarkdownBlockTheme | null;
  codeBackground: string | null;
  diagramBackground: string | null;
}

/** Builds the react-markdown component map with code/diagram renderers bound
 *  to the effective block appearance. Split out from `baseComponents` so a
 *  code/diagram theme change rebuilds only these two renderers — the rest of
 *  the map (headings, lists, tables, …) stays shared. */
function createBlockComponents(appearance: BlockAppearance): Pick<Components, "code" | "pre"> {
  const { codeTheme, diagramTheme, codeBackground, diagramBackground } = appearance;
  return {
    code: ({ className, children }) => {
      const match = /language-(\w+)/.exec(className ?? "");
      if (match) {
        const language = match[1].toLowerCase();
        if (language === "mermaid") {
          return (
            <MermaidDiagram
              chart={textContent(children).trim()}
              themeOverride={diagramTheme}
              background={diagramBackground}
            />
          );
        }
        return (
          <Code
            code={textContent(children)}
            language={match[1]}
            themeOverride={codeTheme}
            background={codeBackground}
          />
        );
      }
      return <code dir="ltr" className={styles.inlineCode}>{children}</code>;
    },
    pre: ({ children, node }) => {
      const root = toMdNode(node);
      const kids = (root?.children ?? []).filter(
        (child) => child.type !== "text" || (child.value ?? "").trim(),
      );
      if (kids.length === 1 && kids[0]?.tagName === "code") {
        const codeEl = kids[0];
        const cls = codeEl.properties?.className;
        const cn = Array.isArray(cls) ? cls.join(" ") : String(cls ?? "");
        if (!/language-(\w+)/.test(cn)) {
          const text = (codeEl.children ?? []).map((child) => mdText(child)).join("");
          return (
            <pre
              className={styles.blockCode}
              style={codeBackground ? { backgroundColor: codeBackground } : undefined}
            >
              <code>{text}</code>
            </pre>
          );
        }
      }
      return <>{children}</>;
    },
  };
}

/** Segmented Follow/Light/Dark picker shared by the toolbar blocks panel.
 *  `null` means "follow the app theme". */
function BlockThemeSegment({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MarkdownBlockTheme | null;
  onChange: (next: MarkdownBlockTheme | null) => void;
}) {
  const options: Array<{ id: MarkdownBlockTheme | null; text: string }> = [
    { id: null, text: "Follow" },
    { id: "light", text: "Light" },
    { id: "dark", text: "Dark" },
  ];
  return (
    <div className={styles.blockGroup}>
      <span className={styles.blockLabel}>{label}</span>
      <div className={styles.segment} role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = value === option.id;
          return (
            <button
              key={option.text}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.segmentButton} ${active ? styles.segmentActive : ""}`}
              onClick={() => onChange(option.id)}
            >
              {option.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact background row: custom color input + per-field Follow button. */
function BlockBackgroundRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className={styles.blockGroup}>
      <span className={styles.blockLabel}>{label}</span>
      <div className={styles.blockColorRow}>
        <input
          type="color"
          className={styles.blockColorInput}
          value={value ?? "#ffffff"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Custom ${label.toLowerCase()}`}
          title={`Custom ${label.toLowerCase()}`}
        />
        <span className={styles.blockColorValue}>{value ?? "Follow theme"}</span>
        {value !== null && (
          <button type="button" className={styles.blockFollow} onClick={() => onChange(null)}>
            Follow
          </button>
        )}
      </div>
    </div>
  );
}

const ZOOM_STEP = 10;
const ZOOM_MIN = 60;
const ZOOM_MAX = 200;

/** Stable plugin lists: react-markdown re-parses the whole document whenever
 *  the plugin-array identity changes, so these must never be recreated on
 *  every render. */
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [markGeneratedElements, rehypeRaw, sanitizeRawHtml, rehypeKatex];
const REHYPE_PLUGINS_NO_RAW = [rehypeKatex];

/** Attribute names allowed on raw-HTML elements. Anything else — e.g. names
 *  mangled by markdown emphasis inside a tag (`**classname`, `border-**`) —
 *  is dropped so React never sees an invalid attribute. */
const RAW_HTML_ATTRIBUTES = new Set([
  "href",
  "src",
  "alt",
  "title",
  "dir",
  "colspan",
  "rowspan",
  "start",
]);

/** Tags whose raw-HTML subtrees are discarded entirely (script, media,
 *  interactive controls, …). */
const DROP_RAW_HTML_TAGS = new Set([
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "iframe",
  "input",
  "label",
  "link",
  "meta",
  "noscript",
  "object",
  "option",
  "picture",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "track",
  "video",
]);

interface HastNode {
  type?: string;
  tagName?: unknown;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Marker stamped on every element produced from Markdown syntax (see
 *  `markGeneratedElements`). Raw-HTML elements parsed later by `rehypeRaw`
 *  never carry it, so the sanitizer can tell the two apart — even though
 *  `rehypeRaw` rebuilds node identities (the marker travels as a `data-*`
 *  attribute through its HTML round-trip). Removed again by the sanitizer,
 *  so it never reaches React. */
const GENERATED_MARKER = "dataReadlynxSafe";

/** Runs before `rehypeRaw`: every element in the tree at this point was
 *  produced from Markdown syntax (raw HTML is still unparsed `raw` nodes),
 *  so stamp them for the sanitizer below. */
function markGeneratedElements(): (tree: HastNode) => void {
  const walk = (node: HastNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element") {
      node.properties = { ...(node.properties ?? {}), [GENERATED_MARKER]: "true" };
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  return walk;
}

/** Sanitizes the raw-HTML tree produced by `rehypeRaw`. Translation output
 *  often carries JSX/Tailwind fragments (e.g. `<div className=…>` or
 *  `<div inline-flex flex-col…>`); tags survive but every attribute that is
 *  not in the whitelist is dropped, so no garbage classes/attributes reach
 *  React and no invalid-attribute warnings are raised. Elements stamped by
 *  `markGeneratedElements` keep their attributes (stripping them would kill
 *  code highlighting, KaTeX styling and task-list checkboxes) — only the
 *  marker itself is removed, and their children are still visited since raw
 *  HTML can nest inside them (e.g. a `<span>` inside a heading). */
function sanitizeRawHtml(): (tree: HastNode) => void {
  const walk = (node: HastNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element") {
      const props = node.properties;
      if (props && props[GENERATED_MARKER] !== undefined) {
        delete props[GENERATED_MARKER];
      } else {
        const tag = String(node.tagName ?? "").toLowerCase();
        if (DROP_RAW_HTML_TAGS.has(tag)) {
          node.tagName = "span";
          node.properties = {};
          node.children = [];
          return;
        }
        if (props) {
          for (const name of Object.keys(props)) {
            if (!RAW_HTML_ATTRIBUTES.has(name)) {
              delete props[name];
            }
          }
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  return walk;
}

interface MarkdownProps {
  content: string;
  className?: string;
  /** Shows the reader toolbar: zoom in/out, background/text colors, font
   *  family and fullscreen (mirrors the EPUB viewer's settings). */
  toolbar?: boolean;
  /** Parses raw HTML embedded in the markdown. Defaults to true; disable for
   *  AI-produced content so HTML/JSX snippets render as literal text. */
  rawHtml?: boolean;
  /** Book id for persisting reader settings (zoom, font, colors) in the
   *  `ReaderSettings` table; the EPUB viewer uses the same book id with
   *  its own viewer key. Omit in previews to keep settings in memory. */
  settingsBookId?: string;
  /** When provided, a floating "Ask AI" bubble appears next to text
   *  selections and hands the selected text to the host. */
  onAskAi?: (text: string) => void;
  /** Extra controls rendered at the start of the reader toolbar — e.g. the
   *  reading view's page/chapter indicator and prev/next navigation. */
  toolbarExtra?: ReactNode;
  /** Receives the scrollable content element so hosts can read or set the
   *  scroll position (e.g. syncing with the original book view). */
  scrollHostRef?: Ref<HTMLDivElement>;
}

/* ---------- RTL helpers ---------- */

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const props = (node.props as { children?: ReactNode }) ?? {};
    if (props.children) return extractText(props.children);
  }
  return "";
}

function isRtlCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x05ff) || // Hebrew
    (cp >= 0x0600 && cp <= 0x06ff) || // Arabic
    (cp >= 0x0750 && cp <= 0x077f) || // Arabic Supplement
    (cp >= 0xfb50 && cp <= 0xfdff) || // Arabic Presentation Forms-A
    (cp >= 0xfe70 && cp <= 0xfeff) // Arabic Presentation Forms-B
  );
}

function isArabicDigit(cp: number): boolean {
  return (
    (cp >= 0x0660 && cp <= 0x0669) || // Arabic-Indic digits ٠-٩
    (cp >= 0x06f0 && cp <= 0x06f9) // Extended Arabic-Indic (Persian) digits ۰-۹
  );
}

// Direction is decided by the DOMINANT language of the prose, counted per WORD
// rather than per letter, so a long Latin token can't drown out several short
// Persian words. Digits, spaces and punctuation are neutral and don't vote.
function classifyWord(word: string): "rtl" | "ltr" | undefined {
  for (const ch of word) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue; // Arabic/Persian digits are neutral
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  return undefined; // only digits/symbols -> neutral
}

function getDir(node: ReactNode): "rtl" | "ltr" | undefined {
  const text = extractText(node);
  // A text that opens with a Persian/Arabic digit ("۱...", "۰۲...", …)
  // is conventionally Persian — align it right regardless of the rest.
  const lead = text.trim();
  if (lead) {
    const leadCp = lead.codePointAt(0) ?? 0;
    // Opens with a Persian/Arabic digit ("۱...", "۰۲...", …) — conventionally
    // Persian, align right regardless of the rest.
    if (isArabicDigit(leadCp)) return "rtl";
    // Opens with a Persian/Arabic letter — treat as an RTL-run heading/list.
    if (isRtlCodePoint(leadCp)) return "rtl";
  }
  let rtlWords = 0;
  let ltrWords = 0;

  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const cls = classifyWord(raw);
    if (cls === "rtl") rtlWords++;
    else if (cls === "ltr") ltrWords++;
  }

  if (rtlWords > ltrWords) return "rtl";
  if (ltrWords > rtlWords) return "ltr";

  // Equal or no words: decide by first strong letter
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue;
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  return undefined;
}

function dirProps(node: ReactNode): { dir?: "rtl" | "ltr"; style?: CSSProperties } {
  const dir = getDir(node);
  return {
    ...(dir ? { dir } : {}),
    ...(dir === "rtl" ? { style: { textAlign: "right" } } : {}),
  };
}

interface MdNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MdNode[];
}

function toMdNode(value: unknown): MdNode | null {
  if (value && typeof value === "object") return value as MdNode;
  return null;
}

function mdText(node: MdNode | null): string {
  if (!node) return "";
  if (node.type === "text" || node.type === "raw") return node.value ?? "";
  return (node.children ?? []).map((child) => mdText(child)).join("");
}

function textContent(children: ReactNode): string {
  return Array.isArray(children) ? children.join("") : String(children ?? "");
}

/** Escapes `<` characters outside fenced code blocks and inline code spans,
 *  so raw HTML / JSX snippets in AI-written markdown stay visible as plain
 *  text instead of being parsed as elements (which mangles JSX attribute
 *  syntax and can swallow whole paragraphs). */
function escapeHtmlInMarkdown(markdown: string): string {
  if (!markdown.includes("<")) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      const marker = match[1][0];
      if (fence === null) {
        fence = marker;
      } else if (fence === marker) {
        fence = null;
      }
      out.push(line);
      continue;
    }
    out.push(fence ? line : escapeHtmlInLine(line));
  }
  return out.join("\n");
}

function escapeHtmlInLine(line: string): string {
  let out = "";
  let index = 0;
  while (index < line.length) {
    const tick = line.indexOf("`", index);
    if (tick === -1) {
      out += line.slice(index).replace(/</g, "&lt;");
      break;
    }
    out += line.slice(index, tick).replace(/</g, "&lt;");
    let run = 0;
    while (tick + run < line.length && line[tick + run] === "`") run += 1;
    const closing = line.indexOf("`".repeat(run), tick + run);
    if (closing === -1) {
      out += line.slice(tick).replace(/</g, "&lt;");
      break;
    }
    out += line.slice(tick, closing + run);
    index = closing + run;
  }
  return out;
}

/** Per-book global image zoom shared by every image of the book. Provided by
 *  the `Markdown` host (persisted via `useReaderSettings(bookId, "image")`)
 *  so zooming one image updates all of them without re-parsing the document
 *  (the components map stays stable; only the image consumers re-render). */
const ImageZoomContext = createContext<{ zoom: number; setZoom: (next: number) => void } | null>(
  null,
);

function MdImage({ src, alt }: { src?: string; alt?: string }) {
  const ctx = useContext(ImageZoomContext);
  if (!ctx) {
    return <Image src={src} alt={alt ?? "Image"} aspectRatio="16 / 9" className={styles.mdImage} />;
  }
  return (
    <Image
      src={src}
      alt={alt ?? "Image"}
      aspectRatio="16 / 9"
      className={styles.mdImage}
      zoomPct={ctx.zoom}
      onZoomChange={ctx.setZoom}
    />
  );
}

/* eslint-disable @typescript-eslint/no-unused-vars */
const baseComponents: Components = {
  h1: ({ children, node: _node, ...props }) => (
    <h1 className={styles.h1} {...props} {...dirProps(children)}>
      {children}
    </h1>
  ),
  h2: ({ children, node: _node, ...props }) => (
    <h2 className={styles.h2} {...props} {...dirProps(children)}>
      {children}
    </h2>
  ),
  h3: ({ children, node: _node, ...props }) => (
    <h3 className={styles.h3} {...props} {...dirProps(children)}>
      {children}
    </h3>
  ),
  h4: ({ children, node: _node, ...props }) => (
    <h4 className={styles.h4} {...props} {...dirProps(children)}>
      {children}
    </h4>
  ),
  h5: ({ children, node: _node, ...props }) => (
    <h5 className={styles.h5} {...props} {...dirProps(children)}>
      {children}
    </h5>
  ),
  h6: ({ children, node: _node, ...props }) => (
    <h6 className={styles.h6} {...props} {...dirProps(children)}>
      {children}
    </h6>
  ),
  div: ({ children, node: _node, ...props }) => (
    <div {...props} {...dirProps(children)}>
      {children}
    </div>
  ),
  span: ({ children, node: _node, ...props }) => (
    <span {...props} {...dirProps(children)}>
      {children}
    </span>
  ),
  p: ({ children, node: _node, ...props }) => {
    const kids = Array.isArray(children) ? children : [children];
    const mathOnly =
      kids.length > 0 &&
      kids.every(
        (child) =>
          isValidElement(child) &&
          String((child.props as { className?: unknown })?.className ?? "").includes("katex"),
      );
    return (
      <p
        className={styles.p}
        {...props}
        {...dirProps(children)}
        style={mathOnly ? { textAlign: "center" } : undefined}
      >
        {children}
      </p>
    );
  },
  a: ({ href, children }) => {
    // No destination (or a non-website one, already blanked above): render
    // plain text with no link affordance, so clicking does nothing instead
    // of yanking the app window to a blank page.
    if (!href) {
      return <span>{children}</span>;
    }
    return (
      <a dir="ltr" href={href} className={styles.link} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  ul: ({ children, node: _node, className, ...props }) => {
    const cn = Array.isArray(className) ? className.join(" ") : (className ?? "");
    const isTaskList = typeof cn === "string" && cn.includes("contains-task-list");
    return (
      <ul className={`${isTaskList ? styles.tasks : styles.list}${cn ? ` ${cn}` : ""}`} {...props}>
        {children}
      </ul>
    );
  },
  ol: ({ children, node: _node, className, ...props }) => {
    const cn = Array.isArray(className) ? className.join(" ") : (className ?? "");
    const isTaskList = typeof cn === "string" && cn.includes("contains-task-list");
    return (
      <ol className={`${isTaskList ? styles.tasks : styles.list}${cn ? ` ${cn}` : ""}`} {...props}>
        {children}
      </ol>
    );
  },
  li: ({ children, node: _node, className, ...props }) => {
    const cn = Array.isArray(className) ? className.join(" ") : (className ?? "");
    const isTaskItem = typeof cn === "string" && cn.includes("task-list-item");
    return (
      <li
        className={`${isTaskItem ? styles.taskItem : styles.listItem}${cn ? ` ${cn}` : ""}`}
        {...props}
        {...dirProps(children)}
      >
        {children}
      </li>
    );
  },
  blockquote: ({ children, node: _node, ...props }) => (
    <blockquote className={styles.blockquote} {...props} {...dirProps(children)}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className={styles.hr} />,
  img: ({ src, alt }) => <MdImage src={src} alt={alt ?? "Image"} />,
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      const language = match[1].toLowerCase();
      if (language === "mermaid") {
        return <MermaidDiagram chart={textContent(children).trim()} />;
      }
      return <Code code={textContent(children)} language={match[1]} />;
    }
    return <code dir="ltr" className={styles.inlineCode}>{children}</code>;
  },
  pre: ({ children, node }) => {
    // Block code (`pre > code`) without a language carries no `language-*`
    // class, so the `code` renderer below would mistake it for inline code
    // and style it as an inline pill. Catch that shape here (a `pre` whose
    // only meaningful child is a `code` element with no language) and render
    // it as a plain block instead. Fenced blocks *with* a language keep
    // flowing through the `code` renderer into the `Code` component
    // untouched, and raw-HTML `<pre>` elements (any other shape) render as
    // before.
    const root = toMdNode(node);
    const kids = (root?.children ?? []).filter(
      (child) => child.type !== "text" || (child.value ?? "").trim(),
    );
    if (kids.length === 1 && kids[0]?.tagName === "code") {
      const codeEl = kids[0];
      const cls = codeEl.properties?.className;
      const cn = Array.isArray(cls) ? cls.join(" ") : String(cls ?? "");
      if (!/language-(\w+)/.test(cn)) {
        const text = (codeEl.children ?? []).map((child) => mdText(child)).join("");
        return (
          <pre className={styles.blockCode}>
            <code>{text}</code>
          </pre>
        );
      }
    }
    return <>{children}</>;
  },
  th: ({ children, node: _node, ...props }) => (
    <th scope="col" className={tableStyles.headCell} {...props} {...dirProps(children)}>
      {children}
    </th>
  ),
  td: ({ children, node: _node, ...props }) => (
    <td className={tableStyles.cell} {...props} {...dirProps(children)}>
      {children}
    </td>
  ),
  table: ({ node, children }) => {
    const root = toMdNode(node);
    const thead = (root?.children ?? []).find((child) => child.tagName === "thead");
    const tbody = (root?.children ?? []).find((child) => child.tagName === "tbody");
    const headerCells = (thead?.children?.[0]?.children ?? []).map(toMdNode);
    const rowCells = (tbody?.children ?? [])
      .filter((row) => toMdNode(row)?.tagName === "tr")
      .map((row) => (toMdNode(row)?.children ?? []).map(toMdNode));

    /** A cell is "plain" when every child is plain text — such tables are
     *  lifted into the Table component. Any inline markup (code, bold,
     *  links…), spans or a missing header forces the generic render below,
     *  which draws every cell through the components map so the markup keeps
     *  its styling instead of being flattened to text. */
    const isPlain = (cells: (MdNode | null)[]): boolean =>
      cells.length > 0 &&
      cells.every((cell) =>
        (cell?.children ?? []).every(
          (child) => child.type === "text" || child.type === "raw",
        ),
      );

    if (headerCells.length > 0 && isPlain(headerCells) && rowCells.every(isPlain)) {
      const headers = headerCells.map((cell) => mdText(cell).trim());
      const rows = rowCells.map((cells) => cells.map((cell) => mdText(cell).trim()));
      const columns: TableColumn<string[]>[] = headers.map((header, index) => ({
        key: `md-col-${index}`,
        header,
        headerDir: getDir(header),
        render: (row) => {
          const cell = row[index] ?? "";
          return (
            <span dir={getDir(cell)} style={getDir(cell) === "rtl" ? { textAlign: "right" } : undefined}>
              {cell}
            </span>
          );
        },
      }));
      return <Table columns={columns} rows={rows} />;
    }

    return (
      <div className={tableStyles.wrap}>
        <table className={tableStyles.table} {...dirProps(children)}>
          {children}
        </table>
      </div>
    );
  },
};

export function Markdown({
  content,
  className = "",
  toolbar = false,
  rawHtml = true,
  settingsBookId,
  onAskAi,
  toolbarExtra,
  scrollHostRef,
}: MarkdownProps) {
  const {
    zoomPct,
    setZoomPct,
    fontFamily,
    setFontFamily,
    customBg,
    setCustomBg,
    customText,
    setCustomText,
    codeTheme,
    setCodeTheme,
    diagramTheme,
    setDiagramTheme,
    codeBackground,
    setCodeBackground,
    diagramBackground,
    setDiagramBackground,
  } = useReaderSettings(settingsBookId, "markdown");
  /** Per-book global image zoom (one value for every image of the book),
   *  persisted in the `ReaderSettings` table under the "image" viewer. */
  const { zoomPct: imageZoomPct, setZoomPct: setImageZoomPct } = useReaderSettings(
    settingsBookId,
    "image",
  );
  const imageZoomValue = useMemo(
    () => ({ zoom: imageZoomPct, setZoom: setImageZoomPct }),
    [imageZoomPct, setImageZoomPct],
  );
  const [colorOpen, setColorOpen] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const [aiSelection, setAiSelection] = useState<{ x: number; y: number; text: string } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const colorsWrapRef = useRef<HTMLDivElement>(null);
  const blocksWrapRef = useRef<HTMLDivElement>(null);

  /** Shows the floating "Ask AI" bubble next to the end of a text selection
   *  inside this document — only after the mouse button is released, never
   *  while dragging. Hides it when the selection is cleared or moves outside. */
  useEffect(() => {
    if (!onAskAi) return;
    const host = hostRef.current;
    let selecting = false;
    let showTimer: number | undefined;

    const getSelectionInHost = (): Selection | null => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || !text || text.length < 2) {
        setAiSelection(null);
        return null;
      }
      const anchor = sel.anchorNode;
      if (!anchor || !host?.contains(anchor)) {
        setAiSelection(null);
        return null;
      }
      return sel;
    };

    const compute = () => {
      const sel = getSelectionInHost();
      if (!sel) return;
      // Anchor the bubble to the end of the selection's last line.
      const endRect = getSelectionEndRect(sel);
      if (!endRect) {
        setAiSelection(null);
        return;
      }
      const bubbleWidth = 48;
      const rightOfEnd = endRect.right + 8;
      const x =
        rightOfEnd + bubbleWidth <= window.innerWidth - 8
          ? rightOfEnd
          : Math.max(8, endRect.left - bubbleWidth - 8);
      const y = Math.max(8, Math.min(endRect.top - 20, window.innerHeight - bubbleWidth));
      setAiSelection({ x, y, text: sel.toString().trim() });
    };

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      selecting = Boolean(host && target && host.contains(target));
      if (selecting) setAiSelection(null);
    };
    const onUp = () => {
      if (!selecting) return;
      selecting = false;
      compute();
    };
    const onSelectionChange = () => {
      if (showTimer) window.clearTimeout(showTimer);
      if (selecting) return;
      if (!getSelectionInHost()) return;
      // Debounce like epubjs: show only once the selection has been stable for
      // a moment (covers keyboard-driven selections with no mouse events).
      showTimer = window.setTimeout(compute, 250);
    };
    /** Right-clicking inside the document with no text selection hands the
     *  whole document to the AI chat instead of opening the native menu. */
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!host || !target || !host.contains(target)) return;
      const sel = window.getSelection();
      const selected = sel?.toString().trim() ?? "";
      if (sel && !sel.isCollapsed && selected) return;
      event.preventDefault();
      onAskAi(content);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("contextmenu", onContextMenu);
      if (showTimer) window.clearTimeout(showTimer);
    };
  }, [onAskAi, content]);

  /** Exits the in-page fullscreen overlay with Escape. */
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  /** Closes the color picker on outside click or Escape. */
  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (event: MouseEvent) => {
      const wrap = colorsWrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) {
        setColorOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setColorOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colorOpen]);

  /** Closes the code/diagram appearance panel on outside click or Escape. */
  useEffect(() => {
    if (!blocksOpen) return;
    const onDown = (event: MouseEvent) => {
      const wrap = blocksWrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) {
        setBlocksOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBlocksOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [blocksOpen]);

  const handleResetSettings = () => {
    setCustomBg(null);
    setCustomText(null);
    setColorOpen(false);
  };

  const handleResetBlocks = () => {
    setCodeTheme(null);
    setDiagramTheme(null);
    setCodeBackground(null);
    setDiagramBackground(null);
    setBlocksOpen(false);
  };

  const changeZoom = useCallback((delta: number) => {
    setZoomPct((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)));
  }, [setZoomPct]);

  const toggleFullscreen = () => {
    if (!isFullscreen && hostRef.current) {
      setSpacerHeight(hostRef.current.offsetHeight);
    }
    setIsFullscreen((prev) => !prev);
  };

  const body = useMemo(
    () => (rawHtml ? content : escapeHtmlInMarkdown(content)),
    [content, rawHtml],
  );

  /** Component map with the effective code/diagram appearance bound in.
   *  Only rebuilds when those four values change. */
  const components = useMemo<Components>(
    () => ({
      ...baseComponents,
      ...createBlockComponents({ codeTheme, diagramTheme, codeBackground, diagramBackground }),
    }),
    [codeTheme, diagramTheme, codeBackground, diagramBackground],
  );

  /** The rendered document is expensive to build (markdown parse + per-node
   *  RTL analysis + syntax highlighting), so zoom, page colors, fonts,
   *  fullscreen and menu state change just CSS/classes around it. Code and
   *  diagram themes *do* rebuild it because both syntax colors and Mermaid
   *  colors are baked into the output at render time. */
  const documentElement = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rawHtml ? REHYPE_PLUGINS : REHYPE_PLUGINS_NO_RAW}
        components={components}
        urlTransform={safeUrlTransform}
      >
        {body}
      </ReactMarkdown>
    ),
    [body, rawHtml, components],
  );

  /** Theme CSS variables are only needed for the color pickers' current
   *  values, which are only visible while the color panel is open — reading
   *  them here (instead of on every render) avoids a `getComputedStyle` per
   *  frame of any state change. */
  const themeVars = useMemo(() => {
    if (!colorOpen) return { page: "", text: "" };
    const sheet = getComputedStyle(document.documentElement);
    return {
      page: sheet.getPropertyValue("--color-page").trim(),
      text: sheet.getPropertyValue("--color-text").trim(),
    };
  }, [colorOpen]);

  const backgroundColor = customBg ?? (themeVars.page || "#ffffff");
  const textColor = customText ?? (themeVars.text || "#322b26");

  const hostStyle: CSSProperties = {
    ...(customBg ? { backgroundColor: customBg } : {}),
    ...(customText ? ({ "--color-text": customText, color: customText } as CSSProperties) : {}),
    ...(fontFamily ? { fontFamily } : {}),
  };

  const classes = [
    styles.host,
    toolbar ? styles.toolbarHost : "",
    isFullscreen ? styles.fullscreen : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <>
      <div ref={hostRef} className={classes} style={hostStyle} aria-label="Markdown document">
        {toolbar && (
          <div className={styles.toolbar} role="toolbar" aria-label="Markdown reader controls">
            {toolbarExtra}
            {toolbarExtra && <span className={styles.divider} aria-hidden="true" />}
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => changeZoom(-ZOOM_STEP)}
              disabled={zoomPct <= ZOOM_MIN}
              aria-label="Decrease zoom"
              title="Decrease zoom"
            >
              <Minus size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.zoomValue}
              onClick={() => setZoomPct(100)}
              aria-label={`Zoom ${zoomPct} percent, click to reset`}
              title="Reset zoom to 100%"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => changeZoom(ZOOM_STEP)}
              disabled={zoomPct >= ZOOM_MAX}
              aria-label="Increase zoom"
              title="Increase zoom"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className={styles.divider} aria-hidden="true" />
            <FontFamilySelect
              value={fontFamily}
              onSelect={setFontFamily}
              defaultLabel="Reader font"
            />
            <span className={styles.divider} aria-hidden="true" />
            <div className={styles.controlsWrap} ref={colorsWrapRef}>
              <button
                type="button"
                className={`${styles.toolButton} ${colorOpen ? styles.toolButtonActive : ""}`}
                onClick={() => setColorOpen((open) => !open)}
                aria-label="Reader colors"
                title="Reader colors"
                aria-haspopup="true"
                aria-expanded={colorOpen}
              >
                <Palette size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <ColorPickerPanel
                open={colorOpen}
                onClose={() => setColorOpen(false)}
                title="Reader colors"
                sections={[
                  {
                    id: "background",
                    label: "Background color",
                    value: backgroundColor,
                    onChange: setCustomBg,
                  },
                  {
                    id: "text",
                    label: "Text color",
                    value: textColor,
                    onChange: setCustomText,
                  },
                ]}
                resetLabel="Reset to theme"
                onReset={handleResetSettings}
              />
            </div>
            <div className={styles.controlsWrap} ref={blocksWrapRef}>
              <button
                type="button"
                className={`${styles.toolButton} ${blocksOpen ? styles.toolButtonActive : ""}`}
                onClick={() => setBlocksOpen((open) => !open)}
                aria-label="Code and diagram appearance"
                title="Code and diagram appearance"
                aria-haspopup="true"
                aria-expanded={blocksOpen}
              >
                <Braces size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              {blocksOpen && (
                <div
                  className={styles.blocksPanel}
                  role="dialog"
                  aria-label="Code and diagram appearance"
                >
                  <span className={styles.blocksTitle}>Code & diagrams</span>
                  <BlockThemeSegment label="Code theme" value={codeTheme} onChange={setCodeTheme} />
                  <BlockThemeSegment
                    label="Diagram theme"
                    value={diagramTheme}
                    onChange={setDiagramTheme}
                  />
                  <BlockBackgroundRow
                    label="Code background"
                    value={codeBackground}
                    onChange={setCodeBackground}
                  />
                  <BlockBackgroundRow
                    label="Diagram background"
                    value={diagramBackground}
                    onChange={setDiagramBackground}
                  />
                  <button
                    type="button"
                    className={styles.blocksReset}
                    onClick={handleResetBlocks}
                  >
                    Reset to theme
                  </button>
                </div>
              )}
            </div>
            <span className={styles.divider} aria-hidden="true" />
            <button
              type="button"
              className={`${styles.toolButton} ${styles.toolbarEnd} ${isFullscreen ? styles.toolButtonActive : ""}`}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize2 size={16} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
        )}
        <div ref={scrollHostRef} className={`${styles.body}${toolbar ? ` ${styles.bodyScroll}` : ""}`} style={{ zoom: zoomPct / 100 }}>
          <ImageZoomContext.Provider value={imageZoomValue}>
            {documentElement}
          </ImageZoomContext.Provider>
        </div>
      </div>
      {isFullscreen && (
        <div className={styles.fullscreenSpacer} style={{ height: spacerHeight }} aria-hidden="true" />
      )}
      {aiSelection && onAskAi && (
        <AiSelectionBubble
          x={aiSelection.x}
          y={aiSelection.y}
          text={aiSelection.text}
          onAsk={onAskAi}
        />
      )}
    </>
  );
}
