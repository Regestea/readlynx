import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning, Loader2, Minus, Plus, Settings2 } from "lucide-react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import { useTheme } from "../../app/providers/theme/ThemeContext";
import { Select } from "../ui/Select/Select";
import type { SelectOption } from "../ui/Select/Select";
import { ColorSelect } from "../ui/ColorSelect/ColorSelect";
import styles from "./EpubViewer.module.css";

const FONT_STEP = 10;
const FONT_MIN = 60;
const FONT_MAX = 200;

interface FontMetadata {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontMetadata[]>;
  }
}

const FONT_FORCE_SELECTOR =
  "html, body, p, div, span, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, a, em, strong, cite, i, b";

const FONT_OPTIONS: SelectOption[] = [
  { value: "", label: "Book font" },
  { value: "system-ui, sans-serif", label: "System UI" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { value: "Palatino, 'Palatino Linotype', serif", label: "Palatino" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "'Trebuchet MS', 'Segoe UI', sans-serif", label: "Trebuchet MS" },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
  { value: "Segoe UI, system-ui, sans-serif", label: "Segoe UI" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
];

const BG_PRESETS = ["#ffffff", "#f7f2ea", "#e6ded0", "#cbb99b", "#1c2945", "#162033", "#2b2b33"];
const TEXT_PRESETS = ["#322b26", "#111111", "#1c2945", "#5b6b50", "#cbb99b", "#eef2f7", "#ffffff"];

interface EpubViewerProps {
  filePath: string;
  className?: string;
  ariaLabel?: string;
  /** When true, fills the parent instead of using a fixed height. */
  fill?: boolean;
  /** Hide the controls toolbar (used for embedded first-page previews). */
  toolbar?: boolean;
  /** Called once the first page has been rendered. */
  onReady?: () => void;
}

export function EpubViewer({
  filePath,
  className = "",
  ariaLabel = "EPUB document",
  fill = false,
  toolbar = true,
  onReady,
}: EpubViewerProps) {
  const { theme } = useTheme();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [fontPct, setFontPct] = useState(100);
  const [fontFamily, setFontFamily] = useState("");
  const [fontOptions, setFontOptions] = useState<SelectOption[]>(FONT_OPTIONS);
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsWrapRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const fontCssRef = useRef("");
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  /** Enumerates the fonts installed on this computer (Local Font Access API).
   *  Falls back to a static list when unavailable (e.g. permission denied). */
  useEffect(() => {
    let cancelled = false;
    const loadSystemFonts = async () => {
      try {
        if (typeof window.queryLocalFonts !== "function") return;
        const fonts = await window.queryLocalFonts();
        if (cancelled) return;
        const seen = new Set<string>();
        const options = fonts
          .map((font) => font.family.trim())
          .filter((family) => {
            if (!family) return false;
            const key = family.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => a.localeCompare(b))
          .map((family) => ({
            value: /\s/.test(family) ? `"${family}"` : family,
            label: family,
          }));
        setFontOptions([{ value: "", label: "Book font" }, ...options]);
      } catch {
        // Enumeration unavailable — the static FONT_OPTIONS list stays.
      }
    };
    void loadSystemFonts();
    return () => {
      cancelled = true;
    };
  }, []);

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
    style.textContent = fontCssRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setBook(null);
        setError(null);
        setPageNumber(0);
        setNumPages(0);

        const data = await window.readlynx?.readFileBytes(filePath);
        if (!data) {
          throw new Error(`Could not read "${filePath}". The file may not exist.`);
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
          flow: "paginated",
          spread: "none",
          manager: "default",
        });
        renditionRef.current = rendition;
        rendition.themes.fontSize("100%");
        rendition.on("relocated", handleRelocated);
        rendition.hooks.content.register(injectFontStyle);
        await rendition.display();
        onReadyRef.current?.();

        setBook(nextBook);
        setNumPages(nextBook.locations.length());
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
  }, [filePath, injectFontStyle]);

  useEffect(() => {
    const host = hostRef.current;
    const rendition = renditionRef.current;
    if (!host || !rendition) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) rendition.resize(width, height);
    });
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
    const background = customBg ?? (readVar("--color-page") || "#ffffff");
    const text = customText ?? (readVar("--color-text") || "#322b26");
    rendition.themes.override("background-color", background, true);
    rendition.themes.override("color", text, true);
  }, [theme, book, customBg, customText]);

  /** Applies the chosen font family to the whole book by injecting a forced
   *  `!important` stylesheet into every content document. */
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    fontCssRef.current = fontFamily
      ? `${FONT_FORCE_SELECTOR} { font-family: ${fontFamily} !important; }`
      : "";
    (rendition.getContents() as unknown as Contents[]).forEach((content) =>
      injectFontStyle(content),
    );
  }, [fontFamily, book, injectFontStyle]);

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

  const changeFont = (delta: number) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, fontPct + delta));
    setFontPct(next);
    rendition.themes.fontSize(`${next}%`);
  };

  const classes = [styles.viewer, fill ? styles.fill : "", className].filter(Boolean).join(" ");

  const rootStyle = getComputedStyle(document.documentElement);
  const readVar = (name: string) => rootStyle.getPropertyValue(name).trim();
  const backgroundColor = customBg ?? (readVar("--color-page") || "#ffffff");
  const textColor = customText ?? (readVar("--color-text") || "#322b26");

  return (
    <div className={classes} aria-label={ariaLabel}>
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
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => changeFont(-FONT_STEP)}
          disabled={!book || fontPct <= FONT_MIN}
          aria-label="Decrease font size"
          title="Decrease font size"
        >
          <Minus size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.zoomValue}
          onClick={() => {
            setFontPct(100);
            renditionRef.current?.themes.fontSize("100%");
          }}
          aria-label={`Font size ${fontPct} percent, click to reset`}
          title="Reset font size to 100%"
        >
          {fontPct}%
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => changeFont(FONT_STEP)}
          disabled={!book || fontPct >= FONT_MAX}
          aria-label="Increase font size"
          title="Increase font size"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
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
                <Select
                  compact
                  value={fontFamily}
                  onChange={(event) => setFontFamily(event.target.value)}
                  options={fontOptions}
                  aria-label="Font family"
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
  );
}