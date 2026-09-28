import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, Download, FileText, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { Modal } from "../../../components/ui/Modal/Modal";
import type { BookSourceType } from "./types.ts";
import type { TranslationUnitIndex } from "./useTranslation.ts";
import styles from "./TranslationManageModal.module.css";

/** One translatable unit of the book, normalized across source types. */
interface UnitRow {
  /** Stable selection key: `page:12` or `chapter:3`. */
  key: string;
  /** 1-based position in the book. */
  ordinal: number;
  /** What the row says — the chapter title, or the page number. */
  label: string;
  translated: boolean;
  page: number | null;
  chapter: string | null;
}

interface ChapterRefLike {
  index: number;
  key: string;
  title: string;
}

interface TranslationManageModalProps {
  open: boolean;
  onClose: () => void;
  sourceType: BookSourceType;
  /** False while the source is still loading, so the unit list is not
   *  reported as empty. */
  unitsReady: boolean;
  /** Total PDF pages (0 while unknown). */
  pageCount: number;
  /** Chapters of the loaded EPUB, read from the viewer when the dialog opens. */
  chapters: ChapterRefLike[];
  /** Which units already have a translation. */
  unitIndex: TranslationUnitIndex;
  busy: boolean;
  progress: { done: number; total: number } | null;
  status: string | null;
  error: string | null;
  /** Human-readable summary of the settings a run will use. */
  settingsSummary: string;
  /** The per-book settings row (model, method, languages, target language,
   *  instruction, per-format toggles), shared with the reading-view toolbar —
   *  both edit the same persisted settings. */
  controls: ReactNode;
  onRefresh: () => void;
  onTranslate: (request: { pages: number[]; chapters: string[] }) => void;
  onCancel: () => void;
  /** Opens the shared export dialog over this one for the translated units. */
  onOpenExport: () => void;
  /** Failure from loading the units or running the export. */
  exportError: string | null;
}

/** Builds the unit list for the book: one row per PDF page, one per EPUB
 *  chapter, and a single row for the Markdown document (which is one
 *  translation unit regardless of its length). */
function buildRows(
  sourceType: BookSourceType,
  pageCount: number,
  chapters: ChapterRefLike[],
  unitIndex: TranslationUnitIndex,
): UnitRow[] {
  if (sourceType === "pdf") {
    const translated = new Set(unitIndex.pages);
    const rows: UnitRow[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      rows.push({
        key: `page:${page}`,
        ordinal: page,
        label: String(page),
        translated: translated.has(page),
        page,
        chapter: null,
      });
    }
    return rows;
  }
  if (sourceType === "epub") {
    const translated = new Set(unitIndex.chapters);
    // Fall back to positional rows while the viewer's list is not available.
    const list: ChapterRefLike[] =
      chapters.length > 0
        ? chapters
        : Array.from({ length: 0 }, (_value, index) => ({
            index,
            key: String(index),
            title: `Chapter ${index + 1}`,
          }));
    return list.map((chapter) => ({
      key: `chapter:${chapter.key}`,
      ordinal: chapter.index + 1,
      label: chapter.title,
      translated: translated.has(chapter.key),
      page: null,
      chapter: chapter.key,
    }));
  }
  return [
    {
      key: "chapter:markdown",
      ordinal: 1,
      label: "Whole document",
      translated: unitIndex.chapters.includes("markdown"),
      page: null,
      chapter: "markdown",
    },
  ];
}

/** Keeps only the units the filter matches. Pages are matched by exact
 *  number (typing "12" must not also select 120), chapters by title. */
function filterRows(rows: UnitRow[], sourceType: BookSourceType, query: string): UnitRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  if (sourceType === "pdf") {
    const page = Number(needle);
    if (!Number.isInteger(page) || page <= 0) return [];
    return rows.filter((row) => row.page === page);
  }
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
}

/** Icon of the settings section label. */
function SlidersIcon() {
  return <SlidersHorizontal size={14} strokeWidth={2} aria-hidden="true" />;
}

/**
 * "Manage / Export" dialog: shows which pages (PDF) or chapters (EPUB) of the
 * book already have a translation and lets the user translate the whole book
 * or an arbitrary selection, one unit at a time. The translation settings
 * themselves are the same controls the reading-view toolbar shows. The Export
 * section is a placeholder until the export formats are defined.
 */
export function TranslationManageModal({
  open,
  onClose,
  sourceType,
  unitsReady,
  pageCount,
  chapters,
  unitIndex,
  busy,
  progress,
  status,
  error,
  settingsSummary,
  controls,
  onRefresh,
  onTranslate,
  onCancel,
  onOpenExport,
  exportError,
}: TranslationManageModalProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () => buildRows(sourceType, pageCount, chapters, unitIndex),
    [sourceType, pageCount, chapters, unitIndex],
  );
  const visible = useMemo(
    () => filterRows(rows, sourceType, query),
    [rows, sourceType, query],
  );

  /** Re-reads the status list and drops a stale selection every time the
   *  dialog opens, so it always reflects the database. */
  const [seededOpen, setSeededOpen] = useState(false);
  if (open !== seededOpen) {
    setSeededOpen(open);
    if (open) {
      setSelected(new Set());
      setQuery("");
    }
  }
  useEffect(() => {
    if (open) onRefresh();
    // Only the open edge matters: re-running while the dialog stays open
    // would fight the live status updates the bulk run writes into
    // `unitIndex`. `onRefresh` is intentionally left out of the deps — it is
    // a fresh closure on every render and would re-trigger on any state
    // change.
  }, [open]);

  const isPdf = sourceType === "pdf";
  const unitNoun = isPdf ? "page" : sourceType === "epub" ? "chapter" : "document";
  const translatedCount = rows.filter((row) => row.translated).length;
  const missing = rows.filter((row) => !row.translated);
  const total = rows.length;
  const loading = !unitsReady;
  const noUnits = unitsReady && total === 0;
  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(visible.map((row) => row.key)));
  const selectNone = () => setSelected(new Set());
  const selectMissing = () =>
    setSelected(new Set(visible.filter((row) => !row.translated).map((row) => row.key)));

  /** Translates an explicit list of rows (the current selection, or every
   *  unit that has no translation yet). */
  const run = (targets: UnitRow[]) => {
    if (targets.length === 0) return;
    onTranslate({
      pages: targets.map((row) => row.page).filter((page): page is number => page !== null),
      chapters: targets
        .map((row) => row.chapter)
        .filter((chapter): chapter is string => chapter !== null),
    });
  };

  const selectedRows = rows.filter((row) => selected.has(row.key));
  const canRun = !busy && selectedRows.length > 0;
  const canRunAll = !busy && missing.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage translations"
      wide
      footer={
        busy ? (
          <>
            <span className={styles.runStatus} role="status">
              {progress ? `${progress.done}/${progress.total} done` : null}
              {progress && status ? ` · ` : null}
              {status ?? "Working…"}
            </span>
            <Button variant="ghost" className={styles.footerButton} onClick={onCancel}>
              Cancel run
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              className={styles.footerButton}
              onClick={() => run(missing)}
              disabled={!canRunAll}
              title={
                missing.length === 0
                  ? `Every ${unitNoun} already has a translation.`
                  : `Translates the ${missing.length} ${unitNoun}${missing.length === 1 ? "" : "s"} that have no translation yet`
              }
            >
              {missing.length === 0 ? (
                <Check size={14} strokeWidth={2.4} aria-hidden="true" />
              ) : null}
              {missing.length === 0
                ? "All translated"
                : `Translate missing (${missing.length})`}
            </Button>
            <Button
              variant="primary"
              className={styles.footerButton}
              onClick={() => run(selectedRows)}
              disabled={!canRun}
            >
              Translate selected{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
            </Button>
          </>
        )
      }
    >
      <p className={styles.hint}>
        Pick the pages or chapters to translate, then start one at a time with the settings below:{" "}
        {settingsSummary}. A {unitNoun} that is translated again is regenerated with the current
        settings.
      </p>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>
            <SlidersIcon />
            Settings
          </span>
        </div>
        {controls}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {exportError && (
        <p className={styles.error} role="alert">
          {exportError}
        </p>
      )}

      {loading || noUnits ? (
        <div className={styles.state} role="status">
          <Loader2 size={18} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
          <span>
            {loading
              ? `The ${unitNoun} list is not available yet.`
              : isPdf
                ? "This PDF has no pages to translate."
                : sourceType === "epub"
                  ? "No chapters were found in this EPUB."
                  : "This Markdown file has no content to translate."}
          </span>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryCount}>
              <strong>{translatedCount}</strong> of {total} {unitNoun}
              {total === 1 ? "" : "s"} translated
            </span>
            <span className={styles.summaryRight} role="group" aria-label="Selection">
              <Button variant="ghost" className={styles.miniButton} onClick={selectAll}>
                All
              </Button>
              <Button variant="ghost" className={styles.miniButton} onClick={selectMissing}>
                Missing
              </Button>
              <Button variant="ghost" className={styles.miniButton} onClick={selectNone}>
                None
              </Button>
            </span>
          </div>

          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isPdf ? "Page number" : "Search chapter titles"}
            aria-label={isPdf ? "Find a page by number" : "Search chapter titles"}
            leading={<Search size={18} strokeWidth={1.8} />}
          />

          {visible.length === 0 ? (
            <p className={styles.empty}>Nothing matches “{query.trim()}”.</p>
          ) : isPdf ? (
            <div className={styles.grid} role="group" aria-label="Pages">
              {visible.map((row) => {
                const isSelected = selected.has(row.key);
                return (
                  <button
                    key={row.key}
                    type="button"
                    className={styles.cell}
                    data-translated={row.translated ? "yes" : "no"}
                    data-selected={isSelected ? "yes" : "no"}
                    onClick={() => toggle(row.key)}
                    aria-pressed={isSelected}
                    title={`Page ${row.label}${row.translated ? " — translated" : " — not translated"}`}
                  >
                    {row.translated && (
                      <Check size={9} strokeWidth={3} className={styles.cellCheck} aria-hidden="true" />
                    )}
                    {row.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className={styles.list}>
              {visible.map((row) => {
                const isSelected = selected.has(row.key);
                return (
                  <li key={row.key}>
                    <label className={styles.row} data-selected={isSelected ? "yes" : "no"}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(row.key)}
                        aria-label={`${row.label} — ${unitNoun} ${row.ordinal}`}
                      />
                      <span className={styles.rowInfo}>
                        <span className={styles.rowLabel}>{row.label}</span>
                        <span className={styles.rowMeta}>
                          {unitNoun === "chapter"
                            ? `Chapter ${row.ordinal}`
                            : sourceType === "markdown"
                              ? "Single Markdown file"
                              : "Document"}
                        </span>
                      </span>
                      <span
                        className={styles.badge}
                        data-translated={row.translated ? "yes" : "no"}
                      >
                        {row.translated ? "Translated" : "Not translated"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>
            <FileText size={14} strokeWidth={2} aria-hidden="true" />
            Export
          </span>
          <span className={styles.sectionNote}>
            {translatedCount === 0 ? "Nothing to export" : `${translatedCount} of ${total}`}
          </span>
        </div>
        <p className={styles.sectionHint}>
          {translatedCount === 0
            ? "Translate at least one page or chapter first — the export contains only what is already translated."
            : "Exports the translated pages / chapters, styled with the options you pick next."}
        </p>
        <Button
          variant="secondary"
          className={styles.exportButton}
          onClick={onOpenExport}
          disabled={busy || translatedCount === 0}
        >
          <Download size={14} strokeWidth={1.8} aria-hidden="true" />
          Export translation…
        </Button>
      </div>
    </Modal>
  );
}
