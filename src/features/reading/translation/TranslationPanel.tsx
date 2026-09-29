import { useCallback, useState } from "react";
import { Languages, ListChecks, Loader2, RefreshCw, X } from "lucide-react";
import type { AiModel } from "../../../infrastructure/db/entities/AiModel.ts";
import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import { Button } from "../../../components/ui/Button/Button";
import { ExportDialog } from "../../../components/export/ExportDialog";
import type { ExportContent, ExportSettings } from "../../../components/export/types";
import { PageRangeModal } from "./PageRangeModal.tsx";
import { TranslationControls } from "./TranslationControls.tsx";
import { TranslationManageModal } from "./TranslationManageModal.tsx";
import { runContentExport } from "../export/runContentExport.ts";
import {
  renderTranslatedBook,
  translatedBookContent,
} from "../export/translatedBookContent.tsx";
import { languageLabel } from "./languages.ts";
import type { TranslationMethod, TranslationSettings } from "./types.ts";
import type { TranslationUnitIndex } from "./useTranslation.ts";
import styles from "./TranslationPanel.module.css";

interface TranslationSettingsPanelProps {
  sourceType: BookSourceType;
  models: AiModel[];
  /** Message shown when no AI model is configured. */
  modelsError: string | null;
  /** Ordered AI model ids, in failover order (empty = app default). */
  modelIds: string[];
  onModelIdsChange: (ids: string[]) => void;
  pdfMethod: TranslationMethod;
  onPdfMethodChange: (method: TranslationMethod) => void;
  settings: TranslationSettings;
  onSettingsChange: (patch: Partial<TranslationSettings>) => void;
  /** Re-resolves the selected instruction's text after it is edited in the
   *  instruction manager (the id itself does not change). */
  onInstructionEdited: () => void;
  busy: boolean;
  status: string | null;
  error: string | null;
  hasTranslation: boolean;
  installed: string[];
  downloading: string | null;
  downloadProgress: number | null;
  onDownload: (lang: string) => void;
  onDelete: (lang: string) => void;
  /** Total PDF pages (0 while unknown). */
  pageCount: number;
  /** False while the source is still loading, so the Manage dialog does not
   *  report an empty unit list before the page/chapter count is known. */
  unitsReady: boolean;
  /** Chapters of the loaded EPUB, read from the viewer when the Manage
   *  dialog opens (the viewer's own handle is the only source that has the
   *  parsed table of contents). */
  listChapters: () => Array<{ index: number; key: string; title: string }>;
  /** Which pages / chapters of the book already have a translation. */
  unitIndex: TranslationUnitIndex;
  /** Progress of a running page-range translation (null while idle). */
  progress: { done: number; total: number } | null;
  onTranslate: () => void;
  onRegenerate: () => void;
  onTranslateRange: (from: number, to: number) => void;
  /** Translates an explicit set of pages / chapters (Manage dialog). */
  onTranslateUnits: (request: { pages: number[]; chapters: string[] }) => void;
  /** Re-reads which units of the book have a translation. */
  onRefreshUnitIndex: () => void;
  /** Loads the whole book's cached translation for the export pipeline. */
  onLoadTranslatedUnits: (
    chapterTitles: Record<string, string>,
  ) => Promise<import("../export/translatedBookContent.tsx").TranslatedUnit[]>;
  /** Base file name for the export (the book title). */
  exportFileName: string;
  /** Noun shown in the export dialog, e.g. "Translated book". */
  exportTitle: string;
  /** Stops the running range translation immediately (aborts the AI request). */
  onCancel: () => void;
}

/** Translation settings toolbar, anchored in the reading view header bar:
 *  model, method (OCR / AI Vision), OCR languages, target language, saved
 *  instructions and the translate/regenerate action. Everything is per-book
 *  and persisted into `ReadingState`. */
export function TranslationSettingsPanel({
  sourceType,
  models,
  modelsError,
  modelIds,
  onModelIdsChange,
  pdfMethod,
  onPdfMethodChange,
  settings,
  onSettingsChange,
  onInstructionEdited,
  busy,
  status,
  error,
  hasTranslation,
  installed,
  downloading,
  downloadProgress,
  onDownload,
  onDelete,
  pageCount,
  unitsReady,
  listChapters,
  unitIndex,
  progress,
  onTranslate,
  onRegenerate,
  onTranslateRange,
  onTranslateUnits,
  onRefreshUnitIndex,
  onLoadTranslatedUnits,
  exportFileName,
  exportTitle,
  onCancel,
}: TranslationSettingsPanelProps) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageChapters, setManageChapters] = useState<
    Array<{ index: number; key: string; title: string }>
  >([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportContent, setExportContent] = useState<ExportContent | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const isPdf = sourceType === "pdf";
  const isEpub = sourceType === "epub";
  const actionLabel = hasTranslation ? "Regenerate" : "Translate";
  const rangeMethodLabel = isPdf
    ? pdfMethod === "ocr"
      ? "local OCR"
      : "AI vision"
    : sourceType === "markdown"
      ? "markdown text"
      : "chapter text";
  const rangeTargetLabel = languageLabel(settings.targetLang);
  const rangeModelLabel = modelIds.length
    ? modelIds
        .map((id) => models.find((row) => row.Id === id)?.DisplayName ?? id)
        .join(", ")
    : "app default";
  const manageSettingsSummary = `${rangeMethodLabel}, target ${rangeTargetLabel}, model ${rangeModelLabel}`;

  /** The same settings row, mounted per host: the toolbar adds the
   *  "current page / page range…" picker; the Manage dialog drops it because
   *  it has its own scope and progress display. Run progress is shown by the
   *  host (spinner in the toolbar, footer line in the dialog) while results
   *  and failures arrive as toasts, so no status line is rendered here. */
  const renderControls = (host: "toolbar" | "manage") => (
    <TranslationControls
      sourceType={sourceType}
      models={models}
      modelsError={modelsError}
      modelIds={modelIds}
      onModelIdsChange={onModelIdsChange}
      pdfMethod={pdfMethod}
      onPdfMethodChange={onPdfMethodChange}
      settings={settings}
      onSettingsChange={onSettingsChange}
      onInstructionEdited={onInstructionEdited}
      busy={busy}
      installed={installed}
      downloading={downloading}
      downloadProgress={downloadProgress}
      onDownload={onDownload}
      onDelete={onDelete}
      showUnitPicker={host === "toolbar"}
      onOpenRange={() => setRangeOpen(true)}
      className={host === "toolbar" ? styles.controlsToolbar : styles.controlsDialog}
    />
  );

  /** The Manage dialog needs the chapter list, which only the viewer can
   *  produce (it owns the parsed table of contents) — read on demand. */
  const openManage = () => {
    if (isEpub) {
      setManageChapters(listChapters());
    } else {
      setManageChapters([]);
    }
    setManageOpen(true);
  };

  /** Reads the translated book, then opens the shared export dialog on top of
   *  the Manage dialog. The units are loaded up front because the dialog
   *  asks for the body HTML synchronously. */
  const openExport = useCallback(async () => {
    setExportError(null);
    try {
      const titles: Record<string, string> = {};
      for (const chapter of manageChapters) titles[chapter.key] = chapter.title;
      const units = await onLoadTranslatedUnits(titles);
      if (units.length === 0) {
        setExportError(
          "No translated pages or chapters were found for this book. " +
            "If translations exist, the app needs a full restart — the database " +
            "worker does not reload while the window is open.",
        );
        return;
      }
      // Rendered once here so the dialog can re-paginate its preview and
      // switch formats without re-parsing every chapter each time.
      const bodyHtml = await renderTranslatedBook(units);
      setExportContent(translatedBookContent(exportTitle, bodyHtml));
      setExportOpen(true);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }, [manageChapters, onLoadTranslatedUnits, exportTitle]);

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Translation settings">
      {busy ? (
        <>
          <span className={styles.busyWrap} role="status" title={status ?? "Working…"}>
            <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
            <span className={styles.busyText}>{status ?? "Working…"}</span>
          </span>
          {progress && (
            <span className={styles.progressText} role="status">
              {progress.done}/{progress.total} done · {progress.total - progress.done} left
            </span>
          )}
          <Button
            variant="ghost"
            className={styles.cancelButton}
            onClick={onCancel}
            title="Cancel the running translation"
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
            Cancel
          </Button>
        </>
      ) : (
        <>
          {renderControls("toolbar")}

          <Button
            variant="primary"
            className={styles.action}
            onClick={() => (hasTranslation ? onRegenerate() : onTranslate())}
            disabled={models.length === 0}
          >
            {hasTranslation ? (
              <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
            ) : null}
            {actionLabel}
          </Button>

          <Button
            variant="secondary"
            className={styles.action}
            onClick={openManage}
            disabled={models.length === 0 || !unitsReady}
            title="Translation state of the whole book — translate the entire book or a selection of pages / chapters, and export"
          >
            <ListChecks size={14} strokeWidth={1.8} aria-hidden="true" />
            Manage / Export
          </Button>
        </>
      )}

      <PageRangeModal
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        pageCount={pageCount}
        busy={busy}
        methodLabel={rangeMethodLabel}
        targetLabel={rangeTargetLabel}
        modelLabel={rangeModelLabel}
        onTranslate={(from, to) => onTranslateRange(from, to)}
      />

      <TranslationManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        sourceType={sourceType}
        unitsReady={unitsReady}
        pageCount={pageCount}
        chapters={manageChapters}
        unitIndex={unitIndex}
        busy={busy}
        progress={progress}
        status={status}
        error={error}
        settingsSummary={manageSettingsSummary}
        controls={renderControls("manage")}
        onRefresh={onRefreshUnitIndex}
        onTranslate={onTranslateUnits}
        onCancel={onCancel}
        onOpenExport={() => void openExport()}
        exportError={exportError}
      />

      {exportContent && (
        <ExportDialog
          open={exportOpen}
          raised
          content={exportContent}
          onClose={() => setExportOpen(false)}
          onExport={(settings: ExportSettings) => {
            const content = exportContent;
            setExportOpen(false);
            void runContentExport(content, settings, exportFileName).catch((err: unknown) => {
              setExportError(err instanceof Error ? err.message : String(err));
            });
          }}
        />
      )}
    </div>
  );
}

interface TranslationToggleProps {
  /** True when the translation view is currently showing. */
  active: boolean;
  onClick: () => void;
}

/** Bottom-corner button that only toggles between the original book view and
 *  the translation view. Settings live in the header bar toolbar instead. */
export function TranslationToggle({ active, onClick }: TranslationToggleProps) {
  return (
    <button
      type="button"
      className={`${styles.fab} ${active ? styles.fabActive : ""}`}
      onClick={onClick}
      aria-label={active ? "Back to original book view" : "Show translation view"}
      aria-pressed={active}
      title={active ? "Back to the original book" : "Show translation"}
    >
      <Languages size={20} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}