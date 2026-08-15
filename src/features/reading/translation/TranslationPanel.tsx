import { useEffect, useRef, useState } from "react";
import { ChevronDown, Languages, Loader2, RefreshCw, X } from "lucide-react";
import type { AiModel } from "../../../infrastructure/db/entities/AiModel.ts";
import type { CustomInstructionEntity } from "../../../infrastructure/db/entities/CustomInstruction.ts";
import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import { Button } from "../../../components/ui/Button/Button";
import { Select } from "../../../components/ui/Select/Select";
import { OcrPanel } from "../../../components/pdfViewer/OcrPanel";
import { CustomInstructionsModal } from "./CustomInstructionsModal.tsx";
import { PageRangeModal } from "./PageRangeModal.tsx";
import { NO_LANGUAGE, TRANSLATION_LANGUAGES, languageLabel, ocrLanguagesLabel } from "./languages.ts";
import type { TranslationMethod, TranslationSettings } from "./types.ts";
import styles from "./TranslationPanel.module.css";

/** "Modify…" entry at the bottom of the instruction select: opens the
 *  manager modal instead of picking an instruction. */
const MANAGE_INSTRUCTIONS = "__manage__";

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
  /** Progress of a running page-range translation (null while idle). */
  progress: { done: number; total: number } | null;
  onTranslate: () => void;
  onRegenerate: () => void;
  onTranslateRange: (from: number, to: number) => void;
  /** Stops the running range translation at the next page boundary. */
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
  progress,
  onTranslate,
  onRegenerate,
  onTranslateRange,
  onCancel,
}: TranslationSettingsPanelProps) {
  const [ocrOpen, setOcrOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeSelect, setRangeSelect] = useState("current");
  const [instructions, setInstructions] = useState<CustomInstructionEntity[]>([]);
  const ocrAnchorRef = useRef<HTMLDivElement>(null);
  const modelAnchorRef = useRef<HTMLDivElement>(null);

  /** Saved instruction list: loaded once on mount and refreshed every time
   *  the manager modal closes (it may have created/edited/deleted rows). */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.readlynx?.db.listCustomInstructions();
        if (!cancelled) setInstructions(rows ?? []);
      } catch {
        // keep whatever was loaded before
      }
    };
    if (!manageOpen) void load();
    return () => {
      cancelled = true;
    };
  }, [manageOpen]);

  /** Closes the OCR languages and AI model dropdowns on outside click or
   *  Escape. */
  useEffect(() => {
    if (!ocrOpen && !modelOpen) return;
    const onDown = (event: MouseEvent) => {
      const inOcr = ocrAnchorRef.current?.contains(event.target as Node) ?? false;
      const inModel = modelAnchorRef.current?.contains(event.target as Node) ?? false;
      if (!inOcr && !inModel) {
        setOcrOpen(false);
        setModelOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOcrOpen(false);
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ocrOpen, modelOpen]);

  const isPdf = sourceType === "pdf";
  const isOcr = isPdf && pdfMethod === "ocr";
  const actionLabel = hasTranslation ? "Regenerate" : "Translate";
  const rangeMethodLabel = isPdf
    ? pdfMethod === "ocr"
      ? "local OCR"
      : "AI vision"
    : "chapter text";
  const rangeTargetLabel = languageLabel(settings.targetLang);
  const rangeModelLabel = modelIds.length
    ? modelIds
        .map((id) => models.find((row) => row.Id === id)?.DisplayName ?? id)
        .join(", ")
    : "app default";
  const selectedInstruction = instructions.find(
    (instruction) => instruction.id === settings.customPromptId,
  );
  const instructionValue = selectedInstruction?.id ?? "";

  const handleInstructionChange = (value: string) => {
    if (value === MANAGE_INSTRUCTIONS) {
      setOcrOpen(false);
      setManageOpen(true);
      return;
    }
    if (value === "") {
      onSettingsChange({ customPromptId: "" });
      return;
    }
    const found = instructions.find((instruction) => instruction.id === value);
    if (found) onSettingsChange({ customPromptId: found.id });
  };

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
            title="Stop the translation at the next safe point"
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
            Cancel
          </Button>
        </>
      ) : (
        <>
          {models.length > 0 ? (
            <div className={styles.anchor} ref={modelAnchorRef}>
              <button
                type="button"
                className={`${styles.ocrTrigger} ${modelOpen ? styles.ocrTriggerActive : ""}`}
                onClick={() => setModelOpen((current) => !current)}
                aria-expanded={modelOpen}
                aria-haspopup="dialog"
                title="AI models, in failover order — when one fails the next one retries the request"
              >
                <span className={styles.ocrSummary}>
                  {modelIds.length
                    ? modelIds
                        .map((id) => models.find((row) => row.Id === id)?.DisplayName ?? id)
                        .join(", ")
                    : "App default"}
                </span>
                <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>

              {modelOpen && (
                <div className={styles.modelPanel} role="dialog" aria-label="AI models">
                  <div className={styles.modelPanelHeader}>
                    <span className={styles.modelPanelTitle}>AI models</span>
                    <Button
                      variant="ghost"
                      className={styles.modelClose}
                      onClick={() => setModelOpen(false)}
                      aria-label="Close"
                    >
                      <X size={14} strokeWidth={1.8} aria-hidden="true" />
                    </Button>
                  </div>
                  <p className={styles.modelHint}>
                    Pick one or more models — the order is the failover order:
                    when a request fails, it is retried with the next model
                    automatically. Leave empty to use the app default.
                  </p>
                  <ul className={styles.modelList}>
                    {models.map((row) => {
                      const index = modelIds.indexOf(row.Id);
                      const label = row.DisplayName ?? row.ModelName ?? row.Id;
                      return (
                        <li key={row.Id}>
                          <label className={styles.modelRow}>
                            <input
                              type="checkbox"
                              checked={index !== -1}
                              onChange={() =>
                                onModelIdsChange(
                                  index !== -1
                                    ? modelIds.filter((id) => id !== row.Id)
                                    : [...modelIds, row.Id],
                                )
                              }
                            />
                            {index !== -1 && (
                              <span className={styles.modelBadge}>{index + 1}</span>
                            )}
                            <span className={styles.modelName}>{label}</span>
                            {row.IsDefault ? (
                              <span className={styles.modelTag}>default</span>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <span
              className={styles.modelWarning}
              role="status"
              title={modelsError ?? "No AI model configured"}
            >
              No AI model
            </span>
          )}

      {isPdf && (
        <Select
          compact
          className={styles.control}
          value={pdfMethod}
          onChange={(event) => onPdfMethodChange(event.target.value as TranslationMethod)}
          options={[
            { value: "ocr", label: "OCR" },
            { value: "vision", label: "AI Vision" },
          ]}
          disabled={busy}
          aria-label="Translation method"
          title="How the page text is collected: local OCR or AI vision"
        />
      )}

      {isPdf && (
        <Select
          compact
          className={styles.control}
          value={rangeSelect}
          onChange={(event) => {
            setRangeSelect("current");
            if (event.target.value === "range") setRangeOpen(true);
          }}
          options={[
            { value: "current", label: "Current page" },
            { value: "range", label: "Page range…" },
          ]}
          disabled={busy}
          aria-label="Pages to translate"
          title="Translate the current page, or a range of pages with the settings above"
        />
      )}

      {isOcr && (
        <div className={styles.anchor} ref={ocrAnchorRef}>
          <button
            type="button"
            className={`${styles.ocrTrigger} ${ocrOpen ? styles.ocrTriggerActive : ""}`}
            onClick={() => setOcrOpen((current) => !current)}
            aria-expanded={ocrOpen}
            aria-haspopup="dialog"
            title="OCR languages on the page"
          >
            <span className={styles.ocrSummary}>{ocrLanguagesLabel(settings.ocrLangs)}</span>
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>

          {ocrOpen && (
            <OcrPanel
              open
              title="OCR languages"
              hint="Pick the languages on the page — multi-language pages need more than one selection. Models are stored locally in the app data tessdata folder."
              installed={installed}
              selected={settings.ocrLangs}
              onSelectedChange={(langs) => onSettingsChange({ ocrLangs: langs })}
              downloading={downloading}
              downloadProgress={downloadProgress}
              onDownload={onDownload}
              onDelete={onDelete}
              extracting={busy}
              onClose={() => setOcrOpen(false)}
            />
          )}
        </div>
      )}

      <Select
        compact
        className={styles.control}
        value={settings.targetLang}
        onChange={(event) => onSettingsChange({ targetLang: event.target.value })}
        options={[{ value: NO_LANGUAGE, label: "None" }, ...TRANSLATION_LANGUAGES]}
        disabled={busy}
        aria-label="Target language"
        title="Target language"
      />

      <Select
        compact
        className={styles.control}
        value={instructionValue}
        onChange={(event) => handleInstructionChange(event.target.value)}
        options={[{ value: "", label: "No instruction" }]}
        groups={[
          {
            label: "Saved",
            options: instructions.map((instruction) => ({
              value: instruction.id,
              label: instruction.name,
            })),
          },
          {
            label: "Manage",
            options: [{ value: MANAGE_INSTRUCTIONS, label: "Modify…" }],
          },
        ]}
        disabled={busy}
        aria-label="Custom instruction"
        title="Custom instruction layered on the translation"
      />

      {(status || error) && (
        <span
          className={error ? styles.errorText : styles.statusText}
          role={error ? "alert" : "status"}
          title={error ?? status ?? ""}
        >
          {error ?? status}
        </span>
      )}

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
        </>
      )}

      <CustomInstructionsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        selectedId={settings.customPromptId}
        onSettingsChange={onSettingsChange}
        onInstructionEdited={onInstructionEdited}
      />

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