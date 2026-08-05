import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning, FolderOpen, Loader2, Minus, Plus } from "lucide-react";
import ePub from "epubjs";
import type { Book, Location, Rendition } from "epubjs";
import styles from "./EpubViewer.module.css";

const FONT_STEP = 10;
const FONT_MIN = 60;
const FONT_MAX = 200;

interface EpubViewerProps {
  filePath: string;
  className?: string;
  ariaLabel?: string;
}

export function EpubViewer({ filePath, className = "", ariaLabel = "EPUB document" }: EpubViewerProps) {
  const [path, setPath] = useState(filePath);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [fontPct, setFontPct] = useState(100);
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setBook(null);
        setError(null);
        setPageNumber(0);
        setNumPages(0);

        const data = await window.readlynx?.readFileBytes(path);
        if (!data) {
          throw new Error(`Could not read "${path}". The file may not exist.`);
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
        await rendition.display();

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
  }, [path]);

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

  const handlePick = async () => {
    const picked = await window.readlynx?.pickFile({
      filters: [{ name: "EPUB books", extensions: ["epub"] }],
    });
    if (picked) setPath(picked);
  };

  const classes = [styles.viewer, className].filter(Boolean).join(" ");

  return (
    <div className={classes} aria-label={ariaLabel}>
      <div className={styles.toolbar} role="toolbar" aria-label="EPUB controls">
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void handlePick()}
          aria-label="Open EPUB file"
          title="Open EPUB file"
        >
          <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true" />
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
      </div>

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