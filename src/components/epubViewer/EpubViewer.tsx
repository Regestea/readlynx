import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { ChevronLeft, ChevronRight, FileDown, FileWarning, Loader2, Maximize2, Minus, Minimize2, Palette, Plus } from "lucide-react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import { useTheme } from "../../app/providers/theme/ThemeContext";
import { useReaderSettings } from "../../hooks/useReaderSettings.ts";
import { epubHtmlToCleanedHtmlWithImages, epubHtmlToMarkdown, epubHtmlToPlainTextWithImages } from "../../shared/document/epubToMarkdown";
import type { EpubHtmlExtraction } from "../../shared/document/epubToMarkdown";
import type { EpubImageRef } from "../../shared/document/epubToMarkdown";
import { getSelectionEndRect } from "../../shared/selection";
import { FontFamilySelect } from "../FontFamilySelect/FontFamilySelect";
import { ColorPickerPanel } from "../ui/ColorPickerPanel/ColorPickerPanel";
import { AiSelectionBubble } from "../AiSelectionBubble/AiSelectionBubble";
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
  /** Book id for persisting reader settings (zoom, font, colors) in the
   *  `ReaderSettings` table; the Markdown viewer uses the same book id with
   *  its own viewer key. Omit in previews to keep settings in memory. */
  settingsBookId?: string;
  /** Chapter (spine index as a string) to jump to once the book is laid
   *  out — used to resume reading where the user left off. */
  initialChapter?: string | null;
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
  /** Called with the real book position 0..1 (epubjs location percentage,
   *  proportional to content) whenever the rendered position changes. */
  onProgressChange?: (progress: number) => void;
  /** Called with the currently rendered section converted to Markdown (headings,
   *  lists, quotes, emphasis, … preserved) when "Extract" is pressed. */
  onExtractPage?: (markdown: string) => void;
  /** When provided, a floating "Ask AI" bubble appears next to text
   *  selections inside the book and hands the selected text to the host. */
  onAskAi?: (text: string) => void;
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
  /** Cleaned original chapter HTML (scripts/styles/hidden content removed,
   *  images replaced by `[IMG-n]` tokens) split into request-sized chunks of
   *  complete elements — used when the book opts into Original-HTML mode. */
  getCurrentChapterHtmlExtraction(): EpubHtmlExtraction | null;
  /** Total spine chapters of the loaded book (0 before it loads). */
  getChapterCount(): number;
  /** Jumps to a spine chapter by index (clamped to the book bounds). */
  goToChapter(index: number): void;
  /** Current scroll offset and scrollable range (px) of the rendered chapter,
   *  or null when no scrollable element exists. */
  getChapterScroll(): { top: number; max: number } | null;
  /** Sets the chapter scroll offset in px (clamped to the scrollable range). */
  setChapterScroll(top: number): void;
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
  settingsBookId,
  initialChapter,
  backgroundColorOverride,
  textColorOverride,
  onReady,
  onPageCountChange,
  onChapterChange,
  onProgressChange,
  onExtractPage,
  onAskAi,
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
    hardOverrideText,
    setHardOverrideText,
  } = useReaderSettings(settingsBookId, "epub");
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const [aiSelection, setAiSelection] = useState<{ x: number; y: number; text: string } | null>(null);
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
  const onProgressChangeRef = useRef(onProgressChange);
  const lastChapterKeyRef = useRef<string | null>(null);
  const selectionGuardRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);

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

  /** Chapter HTML + image references for Original-HTML translation mode. */
  const currentChapterHtmlExtraction = useCallback((): EpubHtmlExtraction | null => {
    const rendition = renditionRef.current;
    if (!rendition || !bookRef.current) return null;
    const contents = rendition.getContents() as unknown as Contents[];
    const doc = contents[0]?.document;
    if (!doc?.body) return null;
    const { chunks, images } = epubHtmlToCleanedHtmlWithImages(doc.body);
    if (chunks.length === 0) return null;
    return { chunks, images };
  }, []);

  /** Resolves the element that actually scrolls the rendered chapter. In the
   *  `scrolled-doc` flow epub.js stretches the section iframe to the full
   *  content height, so scrolling usually happens on the manager's
   *  `.epub-container` wrapper; the iframe document is checked first in case
   *  the content overflows inside it. */
  const currentScrollElement = useCallback((): HTMLElement | null => {
    const contents = renditionRef.current?.getContents() as unknown as Contents[] | undefined;
    const doc = contents?.[0]?.document;
    const inFrame = (doc?.scrollingElement ?? doc?.documentElement ?? doc?.body) as HTMLElement | null;
    if (inFrame && inFrame.scrollHeight > inFrame.clientHeight + 1) return inFrame;
    const container = hostRef.current?.querySelector<HTMLElement>(".epub-container");
    if (container && container.scrollHeight > container.clientHeight + 1) return container;
    return null;
  }, []);

  useImperativeHandle(ref, () => ({
    getCurrentChapterMarkdown: currentChapterMarkdown,
    getCurrentChapterText: currentChapterText,
    getCurrentChapterExtraction: currentChapterExtraction,
    getCurrentChapterHtmlExtraction: currentChapterHtmlExtraction,
    // `spineItems` exists at runtime but is missing from epubjs's typings.
    getChapterCount: () =>
      (bookRef.current?.spine as { spineItems?: unknown[] } | undefined)?.spineItems?.length ?? 0,
    goToChapter: (index: number) => {
      const rendition = renditionRef.current;
      const count = (bookRef.current?.spine as { spineItems?: unknown[] } | undefined)?.spineItems
        ?.length;
      if (!rendition || !count) return;
      void rendition.display(Math.min(Math.max(0, index), count - 1));
    },
    getChapterScroll: () => {
      const element = currentScrollElement();
      if (!element) return null;
      return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
    },
    setChapterScroll: (top: number) => {
      const element = currentScrollElement();
      if (!element) return;
      const max = element.scrollHeight - element.clientHeight;
      if (max <= 0) return;
      element.scrollTop = Math.min(max, Math.max(0, top));
    },
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
        rendition.on("selected", handleSelected);
        rendition.hooks.content.register(injectFontStyle);
        rendition.hooks.content.register(highlightCodeBlocks);
        await rendition.display();
        // Resume reading where the user left off: jump to the saved chapter
        // (spine index). The relocated handler fires and reports the restored
        // chapter to the host.
        const restoreIndex = initialChapter === undefined || initialChapter === null
          ? null
          : Number(initialChapter);
        if (restoreIndex !== null && Number.isFinite(restoreIndex)) {
          await rendition.display(restoreIndex);
        }
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
      const pct = bookRef.current.locations.percentageFromCfi(location.start.cfi);
      if (typeof pct === "number") {
        onProgressChangeRef.current?.(Math.min(1, Math.max(0, pct)));
      }
      setAiSelection(null);
    };

    /** Hides the bubble the moment the selection in this contents document is
     *  cleared or collapsed (epubjs 0.3.93 has no `deselected` event, so we
     *  watch `selectionchange` ourselves). */
    const watchDeselect = (contents: Contents) => {
      selectionGuardRef.current?.();
      const onSelectionChange = () => {
        const sel = contents.window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) {
          setAiSelection(null);
        }
      };
      contents.document.addEventListener("selectionchange", onSelectionChange);
      selectionGuardRef.current = () =>
        contents.document.removeEventListener("selectionchange", onSelectionChange);
    };

    /** Floating "Ask AI" bubble next to the end of the reader's text
     *  selection. epubjs fires `selected` ~250ms after the selection stops
     *  changing (never during a drag). The range rect is in the iframe's
     *  internal viewport — offset it by the *iframe element's* position so
     *  the fixed-position bubble lands at the right spot on the app viewport,
     *  no matter how far the scrolled container has scrolled. */
    const handleSelected = (_cfiRange: string, contents: Contents) => {
      watchDeselect(contents);
      const sel = contents.window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || !text || text.length < 2) {
        setAiSelection(null);
        return;
      }
      const iframe = hostRef.current?.querySelector("iframe");
      const iframeRect = iframe?.getBoundingClientRect();
      if (!iframeRect) {
        setAiSelection(null);
        return;
      }
      const endRect = getSelectionEndRect(sel);
      if (!endRect) {
        setAiSelection(null);
        return;
      }
      const bubbleWidth = 48;
      const rightOfEnd = endRect.right + iframeRect.left + 8;
      const x =
        rightOfEnd + bubbleWidth <= window.innerWidth - 8
          ? rightOfEnd
          : Math.max(8, endRect.left + iframeRect.left - bubbleWidth - 8);
      const y = Math.max(
        8,
        Math.min(endRect.top + iframeRect.top - 20, window.innerHeight - bubbleWidth),
      );
      setAiSelection({ x, y, text });
    };

    void load();

    return () => {
      cancelled = true;
      selectionGuardRef.current?.();
      selectionGuardRef.current = null;
      renditionRef.current?.off("relocated", handleRelocated);
      renditionRef.current?.off("selected", handleSelected);
      renditionRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current?.destroy();
      bookRef.current = null;
    };
  }, [filePath, srcData, injectFontStyle, highlightCodeBlocks, initialChapter]);

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
   *  user picked custom colors which then take precedence. When the hard
   *  text-color override is on, the chosen text color is forced onto every
   *  element with `!important`, regardless of the book's own styling. */
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
      `p { background-color: ${background} !important; }`,
      `a { color: ${text} !important; }`,
      `.box1, .box2, .box3, .box4 { background-color: ${background} !important; }`,
      `.box1 *, .box2 *, .box3 *, .box4 * { color: ${text} !important; }`,
      // The zoom effect scales the whole document (`transform: scale`); capping
      // images at 100% of their (scaled) container keeps them exactly in
      // range at any zoom level while the surrounding text still zooms.
      `img { max-width: 100% !important; height: auto !important; }`,
      highlightCssFor(background),
      // Hard override: force the text color onto every element, no matter
      // what the book styles. `* !important` beats any non-important book
      // rule (including inline `style=` colors); the higher-specificity
      // code-token rule below also beats our own `!important` highlight
      // colors so code follows the override too. Kept last so it wins.
      ...(hardOverrideText
        ? [
            `* { color: ${text} !important; }`,
            `pre.source-code code.hljs, pre.source-code code.hljs * { color: ${text} !important; }`,
          ]
        : []),
    ].join("\n");
    (rendition.getContents() as unknown as Contents[]).forEach((content) => injectFontStyle(content));
  }, [theme, book, customBg, customText, hardOverrideText, backgroundColorOverride, textColorOverride, injectFontStyle]);

  /** Closes the color picker on outside click or Escape. */
  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (event: MouseEvent) => {
      const wrap = controlsWrapRef.current;
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

  const handleResetSettings = () => {
    setCustomBg(null);
    setCustomText(null);
    setHardOverrideText(false);
    setColorOpen(false);
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
        <span className={styles.divider} aria-hidden="true" />
        <FontFamilySelect
          value={fontFamily}
          onSelect={setFontFamily}
          defaultLabel="Book font"
        />
        <span className={styles.divider} aria-hidden="true" />
        <div className={styles.controlsWrap} ref={controlsWrapRef}>
          <button
            type="button"
            className={`${styles.toolButton} ${colorOpen ? styles.toolButtonActive : ""}`}
            onClick={() => setColorOpen((open) => !open)}
            disabled={!book}
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
                value: customBg ?? backgroundColor,
                onChange: setCustomBg,
              },
              {
                id: "text",
                label: "Text color",
                value: customText ?? textColor,
                onChange: setCustomText,
                footer: (
                  <label className={styles.hardOverride} title="Force this color onto every text element">
                    <input
                      type="checkbox"
                      className={styles.hardOverrideCheckbox}
                      checked={hardOverrideText}
                      onChange={(event) => setHardOverrideText(event.target.checked)}
                      aria-label="hard override"
                    />
                    <span>hard override</span>
                  </label>
                ),
              },
            ]}
            resetLabel="Reset to theme"
            onReset={handleResetSettings}
          />
        </div>
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