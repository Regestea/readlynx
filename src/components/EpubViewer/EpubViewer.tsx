import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { ChevronLeft, ChevronRight, FileDown, FileWarning, Loader2, Maximize2, Minus, Minimize2, Plus, Settings2 } from "lucide-react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import { useTheme } from "../../app/providers/theme/ThemeContext";
import { useReaderSettings } from "../../hooks/useReaderSettings.ts";
import { epubHtmlToMarkdown, epubHtmlToPlainTextWithImages } from "./epubToMarkdown";
import type { EpubImageRef } from "./epubToMarkdown";
import { FontFamilySelect } from "../ui/FontFamilySelect/FontFamilySelect";
import { ColorSelect } from "../ui/ColorSelect/ColorSelect";
import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import http from "highlight.js/lib/languages/http";
import scala from "highlight.js/lib/languages/scala";
import styles from "./EpubViewer.module.css";

const FONT_STEP = 10;
const FONT_MIN = 60;
const FONT_MAX = 200;

hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("http", http);
hljs.registerLanguage("scala", scala);

/** Language subset for auto-detection: the common programming languages found
 *  in technical books, so Kotlin/Swift/etc. are not misdetected as Java. */
const AUTO_LANGS = [
  "csharp",
  "java",
  "javascript",
  "typescript",
  "python",
  "cpp",
  "c",
  "go",
  "rust",
  "kotlin",
  "swift",
  "sql",
  "bash",
  "json",
  "xml",
  "css",
  "php",
  "ruby",
  "dart",
  "scala",
] as const;

/** Reads a hint from `data-language`, `language-…`/`lang-…` classes, or a
 *  bare language class token (e.g. `csharp`) on the `<pre>`. */
function detectCodeLanguage(pre: HTMLPreElement): string {
  const attr = pre.getAttribute("data-language");
  if (attr && hljs.getLanguage(attr.toLowerCase())) return attr.toLowerCase();
  for (const cls of pre.classList) {
    const match = /^lang(?:uage)?[-_]?([a-z0-9+#-]+)$/i.exec(cls);
    if (!match) continue;
    const lang = match[1].toLowerCase();
    if (hljs.getLanguage(lang)) return lang;
  }
  for (const cls of pre.classList) {
    const lang = cls.toLowerCase();
    if (lang !== "source-code" && hljs.getLanguage(lang)) return lang;
  }
  return "";
}

/** Determines whether a hex background is light (readable with a dark-code
 *  palette) or dark (readable with a light-code palette). */
function backgroundIsLight(background: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return true;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

const HLJS_TOKENS: Record<string, [string, string]> = {
  "hljs-comment": ["#6a737d", "#5c6370"],
  "hljs-quote": ["#6a737d", "#5c6370"],
  "hljs-keyword": ["#d73a49", "#c678dd"],
  "hljs-selector-tag": ["#d73a49", "#c678dd"],
  "hljs-subst": ["#d73a49", "#e5c07b"],
  "hljs-string": ["#032f62", "#98c379"],
  "hljs-doctag": ["#032f62", "#98c379"],
  "hljs-regexp": ["#032f62", "#98c379"],
  "hljs-title": ["#6f42c1", "#61aeee"],
  "hljs-section": ["#6f42c1", "#61aeee"],
  "hljs-selector-id": ["#6f42c1", "#61aeee"],
  "hljs-selector-attr": ["#6f42c1", "#c678dd"],
  "hljs-selector-pseudo": ["#6f42c1", "#c678dd"],
  "hljs-number": ["#005cc5", "#d19a66"],
  "hljs-literal": ["#005cc5", "#d19a66"],
  "hljs-attr": ["#005cc5", "#d19a66"],
  "hljs-attribute": ["#005cc5", "#d19a66"],
  "hljs-template-variable": ["#005cc5", "#d19a66"],
  "hljs-variable": ["#005cc5", "#e06c75"],
  "hljs-built_in": ["#e36209", "#d19a66"],
  "hljs-type": ["#24292e", "#e5c07b"],
  "hljs-title.class_": ["#24292e", "#e5c07b"],
  "hljs-meta": ["#586069", "#61aeee"],
  "hljs-tag": ["#22863a", "#e06c75"],
  "hljs-name": ["#22863a", "#e06c75"],
  "hljs-symbol": ["#e36209", "#56b6c2"],
  "hljs-bullet": ["#e36209", "#56b6c2"],
  "hljs-link": ["#005cc5", "#e06c75"],
  "hljs-emphasis": ["#005cc5", "#e06c75"],
  "hljs-addition": ["#22863a", "#98c379"],
  "hljs-deletion": ["#b31d28", "#e06c75"],
};

/** Highlight.js token colours for `pre.source-code`, chosen to fit the
 *  reader's page background (light or dark palette). */
function highlightCssFor(background: string): string {
  const dark = !backgroundIsLight(background);
  const rows = Object.entries(HLJS_TOKENS)
    .map(([token, [light, darkColor]]) => {
      const color = dark ? darkColor : light;
      const extra = token === "hljs-comment" || token === "hljs-quote" ? "font-style: italic;" : "";
      return `pre.source-code .${token} { color: ${color} !important; ${extra} }`;
    })
    .join("\n");
  return [
    `pre.source-code, pre.source-code code { font-family: Consolas, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace !important; }`,
    `pre.source-code code.hljs { display: block; white-space: pre-wrap; }`,
    rows,
  ].join("\n");
}

/** Every inline/block element that can carry the book's own font-family, so a
 *  forced rule catches all of them (incl. inline `style=` attributes would not
 *  be beatable, but those are rare in EPUBs). */
/** "Times New Roman, serif" -> "\"Times New Roman\", serif" for CSS use. */
function cssFontFamily(value: string): string {
  return value
    .split(",")
    .map((part) => {
      const p = part.trim();
      if (!p) return p;
      return /\s/.test(p) && !/^["']/.test(p) ? `"${p}"` : p;
    })
    .join(", ");
}

const FONT_FORCE_SELECTOR = [
  "html",
  "body",
  "p",
  "div",
  "span",
  "li",
  "td",
  "th",
  "tr",
  "table",
  "blockquote",
  "pre",
  "code",
  "dt",
  "dd",
  "dl",
  "caption",
  "figcaption",
  "figure",
  "address",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "em",
  "strong",
  "cite",
  "i",
  "b",
  "abbr",
  "q",
  "dfn",
  "kbd",
  "samp",
  "var",
  "small",
  "mark",
  "sub",
  "sup",
  "time",
  "summary",
  "details",
  "label",
  "legend",
  "col",
  "colgroup",
  "thead",
  "tbody",
  "tfoot",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
].join(", ");

const BG_PRESETS = ["#ffffff", "#f7f2ea", "#e6ded0", "#cbb99b", "#1c2945", "#162033", "#2b2b33"];
const TEXT_PRESETS = ["#322b26", "#111111", "#1c2945", "#5b6b50", "#cbb99b", "#eef2f7", "#ffffff"];

interface EpubViewerProps {
  /** Path of the EPUB to open; ignored when `srcData` is provided. */
  filePath?: string;
  /** Raw EPUB bytes (e.g. an in-memory export) to render instead of a file. */
  srcData?: ArrayBuffer;
  className?: string;
  ariaLabel?: string;
  /** When true, fills the parent instead of using a fixed height. */
  fill?: boolean;
  /** Hide the controls toolbar (used for embedded first-page previews). */
  toolbar?: boolean;
  /** When combined with `toolbar={false}`, shows only the page-turn buttons. */
  showNav?: boolean;
  /** Hide the "Extract" button (used in the read-only reading mode, where
   *  there is no editor to extract into). */
  showExtract?: boolean;
  /** Per-book key for persisting reader settings (zoom, font, colors) in
   *  localStorage; the Markdown viewer uses the same key per book. */
  settingsKey?: string;
  /** Page/background colour override (png. themes), applied unless the user
   *  picked a custom colour inside the reader. */
  backgroundColorOverride?: string;
  /** Text colour override (used by export previews). */
  textColorOverride?: string;
  /** Called once the first page has been rendered. */
  onReady?: () => void;
  /** Called with the total page count once the book has been laid out. */
  onPageCountChange?: (numPages: number) => void;
  /** Called whenever the current chapter changes. The key is the EPUB spine
   *  index of the section being read (stable for the lifetime of the book). */
  onChapterChange?: (chapterKey: string) => void;
  /** Called with the currently rendered section converted to Markdown (headings,
   *  lists, quotes, emphasis, … preserved) when "Extract" is pressed. */
  onExtractPage?: (markdown: string) => void;
}

/** Imperative handle for hosts that need the current chapter's text (e.g.
 *  reading-mode translation chunks it before calling the AI). */
export interface EpubExtraction {
  /** Chapter text with `[IMG-n]` placeholders in place of images. */
  text: string;
  /** Images found in the chapter, keyed by their placeholder token. */
  images: EpubImageRef[];
}

export interface EpubViewerHandle {
  /** Markdown of the currently rendered section, or null when unavailable. */
  getCurrentChapterMarkdown(): string | null;
  /** Plain text of the currently rendered section (structural markers only,
   *  no inline formatting), used as AI translation input. */
  getCurrentChapterText(): string | null;
  /** Plain text + image references for translation: images are replaced by
   *  `[IMG-n]` tokens so the AI never receives them, and are re-inserted into
   *  the translated Markdown afterwards. */
  getCurrentChapterExtraction(): EpubExtraction | null;
}

export function EpubViewer({
  filePath,
  srcData,
  className = "",
  ariaLabel = "EPUB document",
  fill = false,
  toolbar = true,
  showNav = false,
  showExtract = true,
  settingsKey,
  backgroundColorOverride,
  textColorOverride,
  onReady,
  onPageCountChange,
  onChapterChange,
  onExtractPage,
  ref,
}: EpubViewerProps & { ref?: Ref<EpubViewerHandle> }) {
  const { theme } = useTheme();
  const {
    zoomPct,
    setZoomPct,
    fontFamily,
    setFontFamily,
    customBg,
    setCustomBg,
    customText,
    setCustomText,
  } = useReaderSettings(settingsKey);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsWrapRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const fontCssRef = useRef("");
  const skinCssRef = useRef("");
  const onReadyRef = useRef(onReady);
  const onPageCountChangeRef = useRef(onPageCountChange);
  const onExtractPageRef = useRef(onExtractPage);
  const onChapterChangeRef = useRef(onChapterChange);
  const lastChapterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onPageCountChangeRef.current = onPageCountChange;
  }, [onPageCountChange]);

  useEffect(() => {
    onExtractPageRef.current = onExtractPage;
  }, [onExtractPage]);

  useEffect(() => {
    onChapterChangeRef.current = onChapterChange;
  }, [onChapterChange]);

  /** Markdown of the currently rendered section (the chapter being read),
   *  extracted the same way as the toolbar's "Extract" action. */
  const currentChapterMarkdown = useCallback((): string | null => {
    const rendition = renditionRef.current;
    if (!rendition || !bookRef.current) return null;
    const contents = rendition.getContents() as unknown as Contents[];
    const doc = contents[0]?.document;
    if (!doc?.body) return null;
    const markdown = epubHtmlToMarkdown(doc.body);
    return markdown || null;
  }, []);

  /** Plain text of the currently rendered section (structural markers only),
   *  used as translation input so the AI rebuilds clean Markdown instead of
   *  echoing inline formatting artifacts. */
  const currentChapterText = useCallback((): string | null => {
    const rendition = renditionRef.current;
    if (!rendition || !bookRef.current) return null;
    const contents = rendition.getContents() as unknown as Contents[];
    const doc = contents[0]?.document;
    if (!doc?.body) return null;
    const text = epubHtmlToMarkdown(doc.body, { plain: true });
    return text || null;
  }, []);

  /** Chapter text + image references for translation (see handle doc). */
  const currentChapterExtraction = useCallback((): EpubExtraction | null => {
    const rendition = renditionRef.current;
    if (!rendition || !bookRef.current) return null;
    const contents = rendition.getContents() as unknown as Contents[];
    const doc = contents[0]?.document;
    if (!doc?.body) return null;
    const { text, images } = epubHtmlToPlainTextWithImages(doc.body);
    return { text, images };
  }, []);

  useImperativeHandle(ref, () => ({
    getCurrentChapterMarkdown: currentChapterMarkdown,
    getCurrentChapterText: currentChapterText,
    getCurrentChapterExtraction: currentChapterExtraction,
  }));

  /** Exits the in-page fullscreen overlay with Escape. */
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  /** Injects/replaces a forced font-family stylesheet into an EPUB document. */
  const injectFontStyle = useCallback((content: Contents) => {
    const doc = content.document;
    let style = doc.getElementById("readlynx-font");
    if (!style) {
      style = doc.createElement("style");
      style.id = "readlynx-font";
      const head = doc.head;
      if (head) head.appendChild(style);
    }
    style.textContent = fontCssRef.current + "\n" + skinCssRef.current;
  }, []);

  /** Replaces every `<pre class="source-code">` in a section with a
   *  Highlight.js-highlighted `<code class="hljs">`, unwrapping the book's
   *  `koboSpan`/`strong` wrappers (their text content is the real code). */
  const highlightCodeBlocks = useCallback((content: Contents) => {
    const doc = content.document;
    doc.querySelectorAll("pre.source-code").forEach((element) => {
      const pre = element as HTMLPreElement;
      if (pre.dataset.readlynxHl === "1") return;
      const text = (pre.textContent ?? "").replace(/^\r?\n/, "").replace(/\s+$/, "");
      if (!text.trim()) return;
      let value: string | null = null;
      let detected = "";
      try {
        const language = detectCodeLanguage(pre);
        const result =
          language && hljs.getLanguage(language)
            ? hljs.highlight(text, { language, ignoreIllegals: true })
            : hljs.highlightAuto(text, [...AUTO_LANGS]);
        value = result.value;
        detected = result.language ?? language ?? "";
      } catch {
        // leave `value` as null → block stays untouched
      }
      if (!value) return;
      const code = doc.createElement("code");
      code.className = detected ? `language-${detected} hljs` : "hljs";
      code.innerHTML = value;
      pre.replaceChildren(code);
      pre.dataset.readlynxHl = "1";
    });
  }, []);

  /** Applies the chosen zoom by injecting a CSS `zoom` rule on the content
   *  root. Unlike a `body` font-size override, this also enlarges text whose
   *  size is hard-coded in the book (px headings, etc.) — everything scales
   *  proportionally and re-flows to the viewport width like browser zoom. */
  useEffect(() => {
    const rendition = renditionRef.current;
    const host = hostRef.current;
    if (!rendition || !host) return;
    const scale = zoomPct / 100;
    const transformRule =
      zoomPct !== 100
        ? `html, body { transform-origin: 0 0 !important; transform: scale(${scale}) !important; width: ${100 / scale}% !important; }`
        : `html, body { transform: none !important; width: auto !important; }`;
    fontCssRef.current =
      (fontFamily ? `${FONT_FORCE_SELECTOR} { font-family: ${cssFontFamily(fontFamily)} !important; }` : "") +
      transformRule;
    (rendition.getContents() as unknown as Contents[]).forEach((content) => injectFontStyle(content));
    // Force a resize / reflow after changing the injected styles so the
    // scrolled-doc layout recalculates to the new scaled width.
    rendition.resize(host.clientWidth, host.clientHeight);
  }, [fontFamily, zoomPct, book, injectFontStyle]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setBook(null);
        setError(null);
        setPageNumber(0);
        setNumPages(0);
        setProgressPct(0);

        const data = srcData ?? (filePath ? await window.readlynx?.readFileBytes(filePath) : undefined);
        if (!data) {
          throw new Error("Could not read the EPUB. The file may not exist.");
        }
        if (cancelled) return;

        const nextBook = ePub(data);
        bookRef.current = nextBook;
        await nextBook.ready;
        if (cancelled) {
          nextBook.destroy();
          return;
        }

        await nextBook.locations.generate(1000);
        if (cancelled) {
          nextBook.destroy();
          return;
        }

        const host = hostRef.current;
        if (!host) {
          nextBook.destroy();
          return;
        }

        const rendition = nextBook.renderTo(host, {
          width: "100%",
          height: "100%",
          flow: "scrolled-doc",
          spread: "none",
          manager: "default",
          allowScriptedContent: true,
        });
        renditionRef.current = rendition;
        rendition.on("relocated", handleRelocated);
        rendition.hooks.content.register(injectFontStyle);
        rendition.hooks.content.register(highlightCodeBlocks);
        await rendition.display();
        onReadyRef.current?.();

        setBook(nextBook);
        setNumPages(nextBook.locations.length());
        onPageCountChangeRef.current?.(nextBook.locations.length());
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    const handleRelocated = (location: Location) => {
      if (!bookRef.current || !location.start?.cfi) return;
      const loc = Number(bookRef.current.locations.locationFromCfi(location.start.cfi));
      setPageNumber(Math.min(loc + 1, bookRef.current.locations.length()));
      setProgressPct(
        Math.round(bookRef.current.locations.percentageFromCfi(location.start.cfi) * 100),
      );
      const chapterKey = String(location.start.index);
      if (chapterKey !== lastChapterKeyRef.current) {
        lastChapterKeyRef.current = chapterKey;
        onChapterChangeRef.current?.(chapterKey);
      }
    };

    void load();

    return () => {
      cancelled = true;
      renditionRef.current?.off("relocated", handleRelocated);
      renditionRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current?.destroy();
      bookRef.current = null;
    };
  }, [filePath, srcData, injectFontStyle]);

  useEffect(() => {
    const host = hostRef.current;
    const rendition = renditionRef.current;
    if (!host || !rendition) return;
    const applySize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      rendition.resize(width, height);
    };
    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [book]);

  /** Matches the EPUB page (background + text) to the app theme, unless the
   *  user picked custom colors which then take precedence. */
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const readVar = (name: string) => rootStyle.getPropertyValue(name).trim();
    const background = customBg ?? backgroundColorOverride ?? (readVar("--color-page") || "#ffffff");
    const text = customText ?? textColorOverride ?? (readVar("--color-text") || "#322b26");
    // epubjs `themes.override(name, value)` sets an *inline style* on the body
    // element using `name` as a CSS property, so selector-based rules are
    // silently dropped. Inject a real stylesheet instead so links and the
    // book's decorative boxes follow the reader's palette.
    skinCssRef.current = [
      `html, body { background-color: ${background} !important; color: ${text} !important; }`,
      `a { color: ${text} !important; }`,
      `.box1, .box2, .box3, .box4 { background-color: ${background} !important; }`,
      `.box1 *, .box2 *, .box3 *, .box4 * { color: ${text} !important; }`,
      // The zoom effect scales the whole document (`transform: scale`); capping
      // images at 100% of their (scaled) container keeps them exactly in
      // range at any zoom level while the surrounding text still zooms.
      `img { max-width: 100% !important; height: auto !important; }`,
      highlightCssFor(background),
    ].join("\n");
    (rendition.getContents() as unknown as Contents[]).forEach((content) => injectFontStyle(content));
  }, [theme, book, customBg, customText, backgroundColorOverride, textColorOverride, injectFontStyle]);

  /** Closes the settings dropdown on outside click or Escape. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      const wrap = controlsWrapRef.current;
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

  const goTo = (delta: number) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    if (delta < 0) void rendition.prev();
    else void rendition.next();
  };

  const changeZoom = (delta: number) => {
    setZoomPct((current) => Math.min(FONT_MAX, Math.max(FONT_MIN, current + delta)));
  };

  const toggleFullscreen = () => {
    if (!isFullscreen && viewerRef.current) {
      setSpacerHeight(viewerRef.current.offsetHeight);
    }
    setIsFullscreen((prev) => !prev);
  };

  /** Converts the currently rendered section to Markdown and hands it to the
   *  host (e.g. to append into the editor). Structure — headings, lists,
   *  quotes, emphasis — is preserved by `epubHtmlToMarkdown`. */
  const handleExtractPage = () => {
    const callback = onExtractPageRef.current;
    if (!callback) return;
    const markdown = currentChapterMarkdown();
    if (markdown) callback(markdown);
  };

  const classes = [
    styles.viewer,
    fill ? styles.fill : "",
    isFullscreen ? styles.viewerFullscreen : "",
    className,
  ].filter(Boolean).join(" ");

  const rootStyle = getComputedStyle(document.documentElement);
  const readVar = (name: string) => rootStyle.getPropertyValue(name).trim();
  const backgroundColor = customBg ?? (readVar("--color-page") || "#ffffff");
  const textColor = customText ?? (readVar("--color-text") || "#322b26");

  return (
    <>
    <div ref={viewerRef} className={classes} aria-label={ariaLabel}>
      {toolbar && (
        <div className={styles.toolbar} role="toolbar" aria-label="EPUB controls">
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => goTo(-1)}
          disabled={!book}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.pageInfo}>
          <span className={styles.pageCurrent}>{book ? `${progressPct}%` : "—"}</span>
        </span>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => goTo(1)}
          disabled={!book}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => changeZoom(-FONT_STEP)}
          disabled={!book || zoomPct <= FONT_MIN}
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
          onClick={() => changeZoom(FONT_STEP)}
          disabled={!book || zoomPct >= FONT_MAX}
          aria-label="Increase zoom"
          title="Increase zoom"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
        {showExtract && (
          <>
            <button
              type="button"
              className={styles.extractButton}
              onClick={handleExtractPage}
              disabled={!book}
              aria-label="Extract the current chapter text to the editor"
              title="Extract current chapter text to the editor"
            >
              <FileDown size={16} strokeWidth={2} aria-hidden="true" />
              <span>Extract</span>
            </button>
            <span className={styles.divider} aria-hidden="true" />
          </>
        )}
        <div className={styles.controlsWrap} ref={controlsWrapRef}>
          <button
            type="button"
            className={`${styles.toolButton} ${menuOpen ? styles.toolButtonActive : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            disabled={!book}
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
                  defaultLabel="Book font"
                />
              </div>
              <div className={styles.menuGroup}>
                <span className={styles.menuLabel}>Background color</span>
                <ColorSelect
                  value={customBg ?? backgroundColor}
                  onChange={setCustomBg}
                  presets={BG_PRESETS}
                  label="Background color"
                />
              </div>
              <div className={styles.menuGroup}>
                <span className={styles.menuLabel}>Text color</span>
                <ColorSelect
                  value={customText ?? textColor}
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
          disabled={!book}
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
      {!toolbar && showNav && (
        <div className={styles.toolbar} role="toolbar" aria-label="EPUB page navigation">
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => goTo(-1)}
            disabled={!book}
            aria-label="Previous page"
            title="Previous page"
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className={styles.pageInfo}>
            <span className={styles.pageCurrent}>{numPages > 0 ? pageNumber : "—"}</span>
            <span className={styles.pageOf}>/ {numPages > 0 ? numPages : "—"}</span>
          </span>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => goTo(1)}
            disabled={!book}
            aria-label="Next page"
            title="Next page"
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.hostWrap}>
        {error ? (
          <div className={styles.error} role="alert">
            <FileWarning size={28} strokeWidth={1.8} aria-hidden="true" />
            <p className={styles.errorText}>{error}</p>
          </div>
        ) : (
          <>
            <div ref={hostRef} className={styles.host} />
            {!book && (
              <div className={styles.loading} aria-label="Loading EPUB">
                <Loader2 className={styles.spinner} size={24} strokeWidth={2} />
                <span>Loading EPUB…</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    {isFullscreen && (
      <div className={styles.fullscreenSpacer} style={{ height: spacerHeight }} aria-hidden="true" />
    )}
    </>
  );
}