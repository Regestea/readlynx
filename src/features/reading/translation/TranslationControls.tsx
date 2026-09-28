import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { AiModel } from "../../../infrastructure/db/entities/AiModel.ts";
import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import { Button } from "../../../components/ui/Button/Button";
import { Select } from "../../../components/ui/Select/Select";
import { CustomInstructionSelect } from "../../../components/customInstruction/CustomInstructionSelect";
import { OcrPanel } from "../../../components/pdfViewer/OcrPanel";
import { NO_LANGUAGE, TRANSLATION_LANGUAGES, ocrLanguagesLabel } from "./languages.ts";
import type { TranslationMethod, TranslationSettings } from "./types.ts";
import styles from "./TranslationControls.module.css";

interface TranslationControlsProps {
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
  installed: string[];
  downloading: string | null;
  downloadProgress: number | null;
  onDownload: (lang: string) => void;
  onDelete: (lang: string) => void;
  /** Run status line (and the "no AI model" warning) — hosts that surface
   *  progress themselves (the Manage dialog) turn it off. */
  showStatus?: boolean;
  status?: string | null;
  error?: string | null;
  rateLimitRetry?: number | null;
  /** The "current page / page range…" picker only makes sense next to the
   *  single-unit Translate action, so the Manage dialog hides it. */
  showUnitPicker?: boolean;
  onOpenRange?: () => void;
  /** Extra class on the container so each host can lay the row out. */
  className?: string;
}

/**
 * The per-book translation settings, shared by the reading-view toolbar and
 * the Manage translations dialog so a run can be configured from either
 * place: AI models (in failover order), PDF method (OCR / AI Vision), OCR
 * languages, target language, saved instruction, and the two per-format
 * toggles (EPUB "Enhance translation", PDF vision "Auto include required
 * pictures").
 *
 * The dropdowns own their open state, so each host gets its own copy of the
 * component and the two copies never share a panel.
 */
export function TranslationControls({
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
  installed,
  downloading,
  downloadProgress,
  onDownload,
  onDelete,
  showStatus = true,
  status = null,
  error = null,
  rateLimitRetry = null,
  showUnitPicker = false,
  onOpenRange,
  className = "",
}: TranslationControlsProps) {
  const [ocrOpen, setOcrOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [unitPicker, setUnitPicker] = useState("current");
  const ocrAnchorRef = useRef<HTMLDivElement>(null);
  const modelAnchorRef = useRef<HTMLDivElement>(null);

  /** Closes the OCR languages and AI model dropdowns on outside click or
   *  Escape. A swallowed Escape matters inside the Manage dialog, whose own
   *  Escape handler would otherwise close the whole dialog at the same time
   *  as the dropdown. */
  useEffect(() => {
    if (!ocrOpen && !modelOpen) return;
    const closeAll = () => {
      setOcrOpen(false);
      setModelOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      const inOcr = ocrAnchorRef.current?.contains(event.target as Node) ?? false;
      const inModel = modelAnchorRef.current?.contains(event.target as Node) ?? false;
      if (!inOcr && !inModel) closeAll();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Document-level listeners run before the host's window-level one, so
      // stopping here keeps a single Escape from closing both.
      event.stopPropagation();
      closeAll();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ocrOpen, modelOpen]);

  const isPdf = sourceType === "pdf";
  const isEpub = sourceType === "epub";
  const isOcr = isPdf && pdfMethod === "ocr";

  return (
    <div className={`${styles.controlsBar} ${className}`.trim()}>
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
                        {row.IsDefault ? <span className={styles.modelTag}>default</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <span className={styles.modelWarning} role="status" title={modelsError ?? "No AI model configured"}>
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

      {isPdf && showUnitPicker && (
        <Select
          compact
          className={styles.control}
          value={unitPicker}
          onChange={(event) => {
            setUnitPicker("current");
            if (event.target.value === "range") onOpenRange?.();
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

      <CustomInstructionSelect
        compact
        className={styles.control}
        value={settings.customPromptId}
        onChange={(id) => onSettingsChange({ customPromptId: id })}
        onInstructionEdited={() => onInstructionEdited()}
        disabled={busy}
        ariaLabel="Custom instruction"
        title="Custom instruction layered on the translation"
      />

      {isEpub && (
        <label
          className={styles.htmlToggle}
          title="Enhance translation: check this if the translation is not displaying correctly — for example, broken or missing code blocks or tables. It sends more detail about the chapter to the AI, but uses more data and can be slower."
        >
          <input
            type="checkbox"
            checked={settings.epubExtraction === "html"}
            onChange={(event) =>
              onSettingsChange({ epubExtraction: event.target.checked ? "html" : "markdown" })
            }
            disabled={busy}
            aria-label="Enhance translation"
          />
          <span>Enhance translation</span>
        </label>
      )}

      {showStatus && (status || error) && (
        <span
          className={
            error ? styles.errorText : rateLimitRetry ? styles.retryWarning : styles.statusText
          }
          role={error ? "alert" : "status"}
          title={error ?? status ?? ""}
        >
          {error ?? status}
        </span>
      )}

      {isPdf && pdfMethod === "vision" && (
        <label
          className={styles.htmlToggle}
          title="Auto include required pictures: figures, diagrams, photos and charts that can't be translated are detected automatically and placed into the translation at the right spot. Text-only pages are unaffected. Experimental — results may be unstable."
        >
          <input
            type="checkbox"
            checked={settings.pdfAutoFigures}
            onChange={(event) => onSettingsChange({ pdfAutoFigures: event.target.checked })}
            disabled={busy}
            aria-label="Auto include required pictures"
          />
          <span>Auto include required pictures</span>
        </label>
      )}
    </div>
  );
}
