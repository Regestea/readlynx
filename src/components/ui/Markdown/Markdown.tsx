import { isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { Maximize2, Minus, Minimize2, Plus, Settings2 } from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { Code } from "../Code/Code";
import { Image } from "../Image/Image";
import { Table } from "../Table/Table";
import type { TableColumn } from "../Table/Table";
import { FontFamilySelect } from "../FontFamilySelect/FontFamilySelect";
import { ColorSelect } from "../ColorSelect/ColorSelect";
import styles from "./Markdown.module.css";

const ZOOM_STEP = 10;
const ZOOM_MIN = 60;
const ZOOM_MAX = 200;

const BG_PRESETS = ["#ffffff", "#f7f2ea", "#e6ded0", "#cbb99b", "#1c2945", "#162033", "#2b2b33"];
const TEXT_PRESETS = ["#322b26", "#111111", "#1c2945", "#5b6b50", "#cbb99b", "#eef2f7", "#ffffff"];

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

/** Sanitizes the raw-HTML tree produced by `rehypeRaw`. Translation output
 *  often carries JSX/Tailwind fragments (e.g. `<div className=…>` or
 *  `<div inline-flex flex-col…>`); tags survive but every attribute that is
 *  not in the whitelist is dropped, so no garbage classes/attributes reach
 *  React and no invalid-attribute warnings are raised. */
function sanitizeRawHtml(): (tree: HastNode) => void {
  const walk = (node: HastNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element") {
      const tag = String(node.tagName ?? "").toLowerCase();
      if (DROP_RAW_HTML_TAGS.has(tag)) {
        node.tagName = "span";
        node.properties = {};
        node.children = [];
        return;
      }
      if (node.properties) {
        for (const name of Object.keys(node.properties)) {
          if (!RAW_HTML_ATTRIBUTES.has(name)) {
            delete node.properties[name];
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

/* eslint-disable @typescript-eslint/no-unused-vars */
const components: Components = {
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
  a: ({ href, children }) => (
    <a href={href} className={styles.link} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  ul: ({ children, node: _node, ...props }) => (
    <ul className={styles.list} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, node: _node, ...props }) => (
    <ol className={styles.list} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, node: _node, ...props }) => (
    <li className={styles.listItem} {...props} {...dirProps(children)}>
      {children}
    </li>
  ),
  blockquote: ({ children, node: _node, ...props }) => (
    <blockquote className={styles.blockquote} {...props} {...dirProps(children)}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className={styles.hr} />,
  img: ({ src, alt }) => (
    <Image src={src} alt={alt ?? "Image"} aspectRatio="16 / 9" />
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      return <Code code={textContent(children)} language={match[1]} />;
    }
    return <code className={styles.inlineCode}>{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ node, children }) => {
    const root = toMdNode(node);
    const thead = (root?.children ?? []).find((child) => child.tagName === "thead");
    const tbody = (root?.children ?? []).find((child) => child.tagName === "tbody");
    const headers = (thead?.children?.[0]?.children ?? []).map((cell) =>
      mdText(cell).trim(),
    );
    const rows = (tbody?.children ?? [])
      .filter((row) => toMdNode(row)?.tagName === "tr")
      .map((row) =>
        (toMdNode(row)?.children ?? []).map((cell) => mdText(cell).trim()),
      );
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
    if (columns.length === 0) return <table>{children}</table>;
    return <Table columns={columns} rows={rows} />;
  },
};

export function Markdown({
  content,
  className = "",
  toolbar = false,
  rawHtml = true,
}: MarkdownProps) {
  const [zoomPct, setZoomPct] = useState(100);
  const [fontFamily, setFontFamily] = useState("");
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  /** Exits the in-page fullscreen overlay with Escape. */
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  /** Closes the settings dropdown on outside click or Escape. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      const wrap = controlsRef.current;
      if (wrap && !wrap.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleResetSettings = () => {
    setFontFamily("");
    setCustomBg(null);
    setCustomText(null);
    setMenuOpen(false);
  };

  const changeZoom = useCallback((delta: number) => {
    setZoomPct((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)));
  }, []);

  const toggleFullscreen = () => {
    if (!isFullscreen && hostRef.current) {
      setSpacerHeight(hostRef.current.offsetHeight);
    }
    setIsFullscreen((prev) => !prev);
  };

  const rootStyle = getComputedStyle(document.documentElement);
  const readVar = (name: string) => rootStyle.getPropertyValue(name).trim();

  const body = useMemo(
    () => (rawHtml ? content : escapeHtmlInMarkdown(content)),
    [content, rawHtml],
  );
  const backgroundColor = customBg ?? (readVar("--color-page") || "#ffffff");
  const textColor = customText ?? (readVar("--color-text") || "#322b26");

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
            <div className={styles.controlsWrap} ref={controlsRef}>
              <button
                type="button"
                className={`${styles.toolButton} ${menuOpen ? styles.toolButtonActive : ""}`}
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Reader settings"
                title="Reader settings"
                aria-haspopup="true"
                aria-expanded={menuOpen}
              >
                <Settings2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div className={styles.menuPanel} role="menu" aria-label="Reader settings">
                  <div className={styles.menuGroup}>
                    <span className={styles.menuLabel}>Font family</span>
                    <FontFamilySelect
                      value={fontFamily}
                      onSelect={setFontFamily}
                      defaultLabel="Reader font"
                    />
                  </div>
                  <div className={styles.menuGroup}>
                    <span className={styles.menuLabel}>Background color</span>
                    <ColorSelect
                      value={backgroundColor}
                      onChange={setCustomBg}
                      presets={BG_PRESETS}
                      label="Background color"
                    />
                  </div>
                  <div className={styles.menuGroup}>
                    <span className={styles.menuLabel}>Text color</span>
                    <ColorSelect
                      value={textColor}
                      onChange={setCustomText}
                      presets={TEXT_PRESETS}
                      label="Text color"
                    />
                  </div>
                  <button type="button" className={styles.menuReset} onClick={handleResetSettings}>
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
        <div className={styles.body} style={{ zoom: zoomPct / 100 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={rawHtml ? [rehypeRaw, rehypeKatex, sanitizeRawHtml] : [rehypeKatex]}
            components={components}
          >
            {body}
          </ReactMarkdown>
        </div>
      </div>
      {isFullscreen && (
        <div className={styles.fullscreenSpacer} style={{ height: spacerHeight }} aria-hidden="true" />
      )}
    </>
  );
}
