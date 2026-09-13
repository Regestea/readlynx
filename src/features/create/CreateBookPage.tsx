import { useCallback, useEffect, useRef, useState } from "react";
import { AlignJustify, ArrowLeft, BookOpen, ChevronDown, ChevronUp, Columns2, FileText, GripVertical, PanelLeft, PanelRight, Save, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { DocumentEditor } from "./documentEditor";
import { PdfViewer } from "../../components/pdfViewer/PdfViewer";
import { EpubViewer } from "../../components/epubViewer/EpubViewer";
import { Markdown } from "../../components/markdown/Markdown";
import { ocrTextToMarkdown } from "../../infrastructure/ocr/ocrToMarkdown";
import { useDefaultAiModel } from "../../infrastructure/ai/useDefaultAiModel";
import { resolveProviderBaseUrl } from "../../infrastructure/ai/modelResolver";
import { Button } from "../../components/ui/Button/Button";
import { Select } from "../../components/ui/Select/Select";
import type { EditorAPI } from "./documentEditor/types";
import { DEFAULT_FONT_SIZE_VALUE, ZOOM_OPTIONS } from "./documentEditor/constants";
import { PAGE_MARGIN_MM, PAGE_FORMATS, uniformMargins } from "../../shared/document/pageGeometry";
import type { PageFormat, PageMargins } from "../../shared/document/pageGeometry";
import type { BookSourceType, SaveDocumentPayload } from "../../infrastructure/db/entities/types";
import { useCloseFlush } from "../../shared/closeFlush";
import styles from "./CreateBookPage.module.css";

/** Auto-save cadence: while the toggle is on, the document is saved every
 *  five minutes — but only when the editor actually changed since the last
 *  save, so idle sessions never trigger pointless writes. */
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

/** Vision-mode extraction prompt: the page image goes to the model, which
 *  detects the language itself and returns the content as Markdown with its
 *  structure preserved (headings, lists, tables, …). */
const VISION_EXTRACT_SYSTEM_PROMPT = [
  "You are the extraction engine of a document editor.",
  "A screenshot of one page from a book is provided as an image.",
  "Read and understand all visible text and visual structure on the image.",
  "Transcribe the page faithfully and completely — do not translate the text, keep the original language.",
  "Detect the language of the page yourself; the user will not tell you which language it is.",
  "Return the content as Markdown whose structure mirrors the image as closely as possible: use headings for the titles, tables for tabular content, lists for bulleted items, block quotes for quoted passages, and so on — whatever the image shows, represent it with the matching Markdown element.",
  "Match heading levels to the visual hierarchy of the page: the biggest title is the top heading, smaller titles become subheadings.",
  "Keep the order and grouping of the page exactly as they appear on the image.",
  "Ignore layout line wrapping: lines that break only because the text does not fit the column width are NOT separate paragraphs — join them into flowing paragraphs. Only break a paragraph where the page itself shows a real break (an indent, an extra gap, a new paragraph, a list item, a heading).",
  "Do not insert line breaks at the end of every visual line; paragraphs should read naturally, as if typed in a document editor.",
  "Do not invent text that is not visible on the page.",
  "Output rules:",
  "- Return Markdown only.",
  "- Do not wrap the whole response in a single code fence.",
  "- Do not add any commentary outside the extracted content.",
].join("\n");

interface CreateBookPageProps {
  onBack?: () => void;
  /** When set, the page opens this existing book instead of creating a new one. */
  initialBookId?: string | null;
  initialTitle: string;
  initialMarkdown: string;
  initialCover: string | null;
  /** Called when the split view (editor + source) opens or closes. */
  onSplitChange?: (split: boolean) => void;
}

/** True when a stored `contentJson` is a Lexical editor state the editor can
 *  parse (a JSON string with a `root`). Anything else would crash
 *  `parseEditorState` on open. */
function isValidEditorStateJson(content: string): boolean {
  if (!content || !content.trim().startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed !== null && typeof parsed === "object" && "root" in (parsed as Record<string, unknown>);
  } catch {
    return false;
  }
}

export function CreateBookPage({
  onBack,
  initialBookId,
  initialTitle,
  initialMarkdown,
  initialCover,
  onSplitChange,
}: CreateBookPageProps) {
  const apiRef = useRef<EditorAPI | null>(null);
  const { model: defaultAiModel } = useDefaultAiModel();
  const defaultAiModelRef = useRef(defaultAiModel);
  const [title, setTitle] = useState(initialTitle);
  const [coverImage, setCoverImage] = useState<string | null>(initialCover);
  const [initialState, setInitialState] = useState<string | undefined>(undefined);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [layout, setLayout] = useState<"paged" | "continuous">("paged");
  const [pageFormat, setPageFormat] = useState<PageFormat>("a4");
  const [margins, setMargins] = useState<PageMargins>(uniformMargins(PAGE_MARGIN_MM));
  const [fontFamily, setFontFamily] = useState("");
  const [pages, setPages] = useState(1);
  const [words, setWords] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [source, setSource] = useState<{ sourceType: BookSourceType; filePath: string } | null>(null);
  const [markdownSource, setMarkdownSource] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"split" | "editor" | "source">("split");
  const [sourceRatio, setSourceRatio] = useState(0.4);
  const [dragging, setDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const [autoSave, setAutoSave] = useState(true);
  /** True while the editor holds changes not yet written by the periodic
   *  auto-save tick (set by the editor's `onChange`). */
  const dirtyRef = useRef(false);

  const idsRef = useRef<{ bookId: string; documentId: string } | null>(null);
  const savedKeyRef = useRef("");
  const savingRef = useRef(false);
  const readyRef = useRef(initialBookId == null);
  const firstRunRef = useRef(true);
  /** False until the editor has applied the loaded `initialState` — prevents
   *  autosaves from persisting the still-empty editor state over a document
   *  that already has content (the settings-sync effect can race the
   *  initial-content load microtask on open). */
  const contentLoadedRef = useRef(initialBookId == null);

  useEffect(() => {
    defaultAiModelRef.current = defaultAiModel;
  }, [defaultAiModel]);

  useEffect(() => {
    onSplitChange?.(source != null && sourceMode === "split");
  }, [source, sourceMode, onSplitChange]);

  useEffect(() => {
    if (!initialBookId) return;
    const db = window.readlynx?.db;
    if (!db) return;
    let cancelled = false;
    contentLoadedRef.current = false;
    void db.getBook(initialBookId).then((result) => {
      if (cancelled) return;
      if (!result || !result.document) {
        readyRef.current = true;
        return;
      }
      const { book, document, settings, source: bookSource } = result;
      idsRef.current = { bookId: book.id, documentId: document.id };
      setTitle(book.title);
      setCoverImage(book.coverImage);
      setInitialState(isValidEditorStateJson(document.contentJson) ? document.contentJson : undefined);
      const rawType = String(bookSource?.sourceType ?? "").toLowerCase();
      const sourceType: BookSourceType =
        rawType === "epub" ? "epub" : rawType === "markdown" || rawType === "md" ? "markdown" : "pdf";
      setSource(
        bookSource
          ? {
              sourceType,
              filePath: bookSource.filePath,
            }
          : null,
      );
      if (bookSource && sourceType === "markdown") {
        void window.readlynx?.readFileBytes(bookSource.filePath).then((data) => {
          if (cancelled || !data) return;
          try {
            const text = new TextDecoder("utf-8", { fatal: false }).decode(data).replace(/^\uFEFF/, "");
            if (!cancelled) setMarkdownSource(text);
          } catch {
            // leave the preview empty — the editor itself is unaffected
          }
        });
      } else {
        setMarkdownSource(null);
      }
      if (settings) {
        setLayout(settings.layout);
        setPageFormat(settings.pageFormat);
        setMargins({
          top: settings.marginTop,
          right: settings.marginRight,
          bottom: settings.marginBottom,
          left: settings.marginLeft,
        });
        setZoomIndex(settings.zoomIndex);
        setFontFamily(settings.fontFamily);
      }
      savedKeyRef.current = JSON.stringify({
        title: book.title,
        coverImage: book.coverImage,
        contentJson: document.contentJson,
        settings: settings
          ? {
              layout: settings.layout,
              pageFormat: settings.pageFormat,
              marginTop: settings.marginTop,
              marginRight: settings.marginRight,
              marginBottom: settings.marginBottom,
              marginLeft: settings.marginLeft,
              zoomIndex: settings.zoomIndex,
              fontFamily: settings.fontFamily,
              fontSize: settings.fontSize,
            }
          : null,
      });
      readyRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [initialBookId]);

  /** Called by the editor once the loaded `initialState` has been applied. */
  const handleContentLoaded = useCallback(() => {
    contentLoadedRef.current = true;
  }, []);

  /** Any editor change (typing, formatting, insertions) flags the document as
   *  dirty, so the next auto-save tick actually writes it. */
  const handleEditorChange = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const buildPayload = useCallback(
    (json: string): Omit<SaveDocumentPayload, "bookId"> => ({
      title,
      coverImage,
      contentJson: json,
      settings: {
        layout,
        pageFormat,
        marginTop: margins.top,
        marginRight: margins.right,
        marginBottom: margins.bottom,
        marginLeft: margins.left,
        zoomIndex,
        fontFamily,
        fontSize: parseFloat(DEFAULT_FONT_SIZE_VALUE),
      },
    }),
    [layout, pageFormat, margins, zoomIndex, fontFamily, title, coverImage],
  );

  /** Saves the current document + settings. Creates the book row only on the
   *  first save; every later save updates the existing record. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    const db = window.readlynx?.db;
    if (!db || savingRef.current || !readyRef.current || !contentLoadedRef.current) return false;
    const json = apiRef.current?.saveState() ?? "";
    const payload = buildPayload(json);
    const key = JSON.stringify(payload);
    if (key === savedKeyRef.current) return false;
    savingRef.current = true;
    try {
      const ids = idsRef.current ?? (await db.createBook());
      idsRef.current = ids;
      await db.saveDocument({ bookId: ids.bookId, ...payload });
      savedKeyRef.current = key;
      return true;
    } finally {
      savingRef.current = false;
    }
  }, [buildPayload]);

  /** Document settings are persisted immediately when they change. The first
   *  run only records the baseline so StrictMode's phantom remount (and any
   *  other render with no real change) can't create an empty book. Later runs
   *  defer to a microtask so the editor content loaded via `initialState` is
   *  applied first — otherwise the freshly opened document could be
   *  overwritten with the still-empty editor state. */
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      if (idsRef.current === null) {
        const json = apiRef.current?.saveState() ?? "";
        savedKeyRef.current = JSON.stringify(buildPayload(json));
      }
      return;
    }
    queueMicrotask(() => {
      void saveNow();
    });
  }, [layout, pageFormat, margins, zoomIndex, fontFamily, saveNow, buildPayload]);

  const handleBack = async () => {
    try {
      await saveNow();
    } finally {
      onBack?.();
    }
  };

  /** Periodic save while auto-save is on. Ticks only write when the editor
   *  was changed since the last save (the dirty flag) — a user who walked
   *  away never causes a pointless save. */
  useEffect(() => {
    if (!autoSave) return;
    const timer = window.setInterval(() => {
      if (!dirtyRef.current) return;
      void saveNow().then(() => {
        dirtyRef.current = false;
      });
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoSave, saveNow]);

  /** The app closing flushes the same pending save the back button would. */
  useCloseFlush(async () => {
    await saveNow();
  });

  /** Appends OCR-recognized text (from the source PDF) to the document. */
  const handleOcrText = useCallback(
    (text: string) => {
      const markdown = ocrTextToMarkdown(text);
      if (!markdown) return;
      apiRef.current?.appendMarkdown(markdown);
      void saveNow();
    },
    [saveNow],
  );

  /** AI vision extraction: sends the current page image to the default AI
   *  model, which transcribes the page (detecting the language itself) and
   *  returns Markdown that keeps the layout structure — following the user's
   *  optional instructions (structure preferences, notes, anything). The
   *  returned text is appended to the editor and saved — the PDF viewer then
   *  reports the outcome in the extract panel. */
  const handleAiVision = useCallback(
    async ({ image, instruction }: { image: string; instruction: string }): Promise<string> => {
      const model = defaultAiModelRef.current;
      if (!model) {
        throw new Error("No AI model configured. Add one in Settings → AI Models.");
      }
      if (!model.APIKey || !model.ModelName) {
        throw new Error(
          "The default AI model is missing an API key or model name. Fix it in Settings → AI Models.",
        );
      }
      const ai = window.readlynx?.ai;
      if (!ai) throw new Error("The AI bridge is not available.");
      const trimmedInstruction = instruction.trim();
      const response = await ai.chat({
        input: {
          url: resolveProviderBaseUrl(model),
          apiKey: model.APIKey,
          modelName: model.ModelName,
        },
        messages: [
          { role: "system", content: VISION_EXTRACT_SYSTEM_PROMPT },
          {
            role: "user",
            content: trimmedInstruction
              ? `Extract the text of the page in the image as Markdown, preserving its structure. Follow the user's instruction:\n\n${trimmedInstruction}`
              : "Extract the text of the page in the image as Markdown, preserving its structure.",
          },
        ],
        images: [image],
      });
      const markdown = (response ?? "").trim();
      if (!markdown) throw new Error("The AI returned no text for this page.");
      apiRef.current?.appendMarkdown(markdown);
      void saveNow();
      return markdown;
    },
    [saveNow],
  );

  /** Appends the EPUB source's current chapter to the document, keeping its
   *  structure (headings, lists, quotes, …) via the Markdown conversion. */
  const handleExtractEpubPage = useCallback(
    (markdown: string) => {
      if (!markdown.trim()) return;
      apiRef.current?.appendMarkdown(markdown);
      void saveNow();
    },
    [saveNow],
  );

  const zoom = ZOOM_OPTIONS[Math.min(ZOOM_OPTIONS.length - 1, Math.max(0, zoomIndex))];

  const goToMatch = (delta: number) => {
    if (searchCount <= 0) return;
    setSearchIndex((index) => (index + delta + searchCount) % searchCount);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      setSearchQuery("");
      setSearchIndex(0);
    }
  };

  const clampRatio = (ratio: number) => Math.min(0.75, Math.max(0.2, ratio));

  const handleSplitDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const split = splitRef.current;
    if (!split) return;
    const move = (moveEvent: PointerEvent) => {
      const rect = split.getBoundingClientRect();
      if (rect.width <= 0) return;
      setSourceRatio(clampRatio((moveEvent.clientX - rect.left) / rect.width));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setSourceRatio((ratio) => clampRatio(ratio + (event.key === "ArrowLeft" ? -0.05 : 0.05)));
    }
  };

  return (
    <main className={styles.page} aria-label="Create book">
      <header className={`${styles.topBar} animate-fade-up`}>
        <Button variant="icon" className={styles.backButton} aria-label="Back to home" onClick={handleBack}>
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>

        <div className={styles.searchBox}>
          <Search size={15} strokeWidth={1.8} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search the document"
            aria-label="Search the document"
          />
          {searchQuery && (
            <>
              <span className={styles.searchCount}>
                {searchCount > 0 ? `${searchIndex + 1} / ${searchCount}` : "0"}
              </span>
              <button
                type="button"
                className={styles.searchNav}
                onClick={() => goToMatch(-1)}
                aria-label="Previous match"
                disabled={searchCount === 0}
              >
                <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.searchNav}
                onClick={() => goToMatch(1)}
                aria-label="Next match"
                disabled={searchCount === 0}
              >
                <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.searchNav}
                onClick={() => {
                  setSearchQuery("");
                  setSearchIndex(0);
                }}
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className={`${styles.autoSave} ${autoSave ? styles.autoSaveActive : ""}`}
          aria-pressed={autoSave}
          onClick={() => setAutoSave((value) => !value)}
          title={
            autoSave
              ? "Auto-save is on — the document is saved every 5 minutes after changes"
              : "Auto-save is off"
          }
        >
          <Save size={15} strokeWidth={1.8} aria-hidden="true" />
          Auto save {autoSave ? "On" : "Off"}
        </button>

        <div className={styles.stats} aria-label="Book statistics">
          {layout === "paged" && (
            <span className={styles.stat}>
              <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
              {pages} {pages === 1 ? "page" : "pages"}
            </span>
          )}
          <span className={styles.stat}>{words.toLocaleString()} words</span>
        </div>

        {source && (
          <div className={styles.viewGroup} role="group" aria-label="View">
            <button
              type="button"
              className={`${styles.viewButton} ${sourceMode === "editor" ? styles.viewButtonActive : ""}`}
              aria-pressed={sourceMode === "editor"}
              onClick={() => setSourceMode("editor")}
              title="Show the editor only"
            >
              <PanelLeft size={15} strokeWidth={1.8} aria-hidden="true" />
              Editor
            </button>
            <button
              type="button"
              className={`${styles.viewButton} ${sourceMode === "split" ? styles.viewButtonActive : ""}`}
              aria-pressed={sourceMode === "split"}
              onClick={() => setSourceMode("split")}
              title="Show the editor and the source document side by side"
            >
              <Columns2 size={15} strokeWidth={1.8} aria-hidden="true" />
              Split
            </button>
            <button
              type="button"
              className={`${styles.viewButton} ${sourceMode === "source" ? styles.viewButtonActive : ""}`}
              aria-pressed={sourceMode === "source"}
              onClick={() => setSourceMode("source")}
              title="Show the source document only"
            >
              <PanelRight size={15} strokeWidth={1.8} aria-hidden="true" />
              Source
            </button>
          </div>
        )}

        <div className={styles.layout} role="group" aria-label="Layout">
          <button
            type="button"
            className={`${styles.layoutButton} ${layout === "paged" ? styles.layoutButtonActive : ""}`}
            aria-pressed={layout === "paged"}
            onClick={() => setLayout("paged")}
            title="Show the document as separate pages"
          >
            <BookOpen size={15} strokeWidth={1.8} aria-hidden="true" />
            Pages
          </button>
          <button
            type="button"
            className={`${styles.layoutButton} ${layout === "continuous" ? styles.layoutButtonActive : ""}`}
            aria-pressed={layout === "continuous"}
            onClick={() => setLayout("continuous")}
            title="Show the document as one continuous page"
          >
            <AlignJustify size={15} strokeWidth={1.8} aria-hidden="true" />
            Continuous
          </button>
        </div>

        {layout === "paged" && (
          <Select
            className={styles.pageSizeSelect}
            aria-label="Page size"
            value={pageFormat}
            onChange={(event) => setPageFormat(event.target.value as PageFormat)}
            options={Object.entries(PAGE_FORMATS).map(([value, info]) => ({
              value,
              label: info.label,
            }))}
          />
        )}

        <div className={styles.zoom} role="group" aria-label="Zoom">
          <Button
            variant="icon"
            className={styles.zoomButton}
            aria-label="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
          >
            <ZoomOut size={16} strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <Button
            variant="icon"
            className={styles.zoomButton}
            aria-label="Zoom in"
            disabled={zoomIndex === ZOOM_OPTIONS.length - 1}
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_OPTIONS.length - 1, index + 1))}
          >
            <ZoomIn size={16} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className={styles.editorArea}>
        {source ? (
          <div ref={splitRef} className={sourceMode === "split" ? styles.split : styles.single}>
            <div
              className={sourceMode === "editor" ? styles.hidden : styles.sourcePanel}
              style={sourceMode === "split" ? { flex: `0 0 ${sourceRatio * 100}%` } : undefined}
            >
              {source.sourceType === "pdf" ? (
                <PdfViewer
                  filePath={source.filePath}
                  fill
                  fitWidth
                  onOcrText={handleOcrText}
                  onAiVision={handleAiVision}
                />
              ) : source.sourceType === "epub" ? (
                <EpubViewer filePath={source.filePath} fill onExtractPage={handleExtractEpubPage} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (markdownSource) handleExtractEpubPage(markdownSource);
                      }}
                      disabled={!markdownSource}
                      title="Append the Markdown file content to the editor"
                    >
                      Append to editor
                    </Button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px" }}>
                    {markdownSource === null ? (
                      <span>Loading Markdown…</span>
                    ) : (
                      <Markdown content={markdownSource} />
                    )}
                  </div>
                </div>
              )}
            </div>
            {sourceMode === "split" && (
              <div
                className={`${styles.divider} ${dragging ? styles.dividerActive : ""}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the source panel"
                aria-valuenow={Math.round(sourceRatio * 100)}
                aria-valuemin={20}
                aria-valuemax={75}
                tabIndex={0}
                onPointerDown={handleSplitDragStart}
                onKeyDown={handleDividerKeyDown}
              >
                <GripVertical size={14} strokeWidth={1.6} aria-hidden="true" />
              </div>
            )}
            <DocumentEditor
              className={
                sourceMode === "source" ? `${styles.editorRoot} ${styles.hidden}` : styles.editorRoot
              }
              apiRef={apiRef}
              paged={layout === "paged"}
              pageFormat={pageFormat}
              margins={margins}
              onMarginsChange={setMargins}
              initialMarkdown={initialMarkdown}
              initialState={initialState}
              defaultFontFamily={fontFamily}
              onDefaultFontFamilyChange={setFontFamily}
              onChange={handleEditorChange}
              onSave={() => {
                void saveNow();
              }}
              zoom={zoom}
              onPageCountChange={setPages}
              onWordCountChange={setWords}
              searchQuery={searchQuery}
              searchActiveIndex={searchIndex}
              onSearchResultCount={setSearchCount}
              onInitialContentLoaded={handleContentLoaded}
              coverImage={coverImage ?? undefined}
            />
          </div>
        ) : (
          <DocumentEditor
            className={styles.editorRoot}
            apiRef={apiRef}
            paged={layout === "paged"}
            pageFormat={pageFormat}
            margins={margins}
            onMarginsChange={setMargins}
            initialMarkdown={initialMarkdown}
            initialState={initialState}
            defaultFontFamily={fontFamily}
            onDefaultFontFamilyChange={setFontFamily}
            onSave={() => {
              void saveNow();
            }}
            zoom={zoom}
            onPageCountChange={setPages}
            onWordCountChange={setWords}
            searchQuery={searchQuery}
            searchActiveIndex={searchIndex}
            onSearchResultCount={setSearchCount}
            onInitialContentLoaded={handleContentLoaded}
            coverImage={coverImage ?? undefined}
          />
        )}
      </div>
    </main>
  );
}
