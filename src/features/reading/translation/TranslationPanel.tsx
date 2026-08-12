import { useEffect, useRef, useState } from "react";
import { Bot, Languages, Loader2, RefreshCw, Settings2 } from "lucide-react";
import type { AiModel } from "../../../infrastructure/db/entities/AiModel.ts";
import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import { Button } from "../../../components/ui/Button/Button";
import { Select } from "../../../components/ui/Select/Select";
import { TextArea } from "../../../components/ui/TextArea/TextArea";
import { OcrPanel } from "../../../components/pdfViewer/OcrPanel";
import { AUTO_LANGUAGE, TRANSLATION_LANGUAGES } from "./languages.ts";
import type { TranslationMethod, TranslationSettings } from "./types.ts";
import styles from "./TranslationPanel.module.css";

interface TranslationSettingsPanelProps {
  sourceType: BookSourceType;
  pdfMethod: TranslationMethod;
  onPdfMethodChange: (method: TranslationMethod) => void;
  settings: TranslationSettings;
  onSettingsChange: (patch: Partial<TranslationSettings>) => void;
  busy: boolean;
  status: string | null;
  error: string | null;
  hasTranslation: boolean;
  model: AiModel | null;
  modelsError: string | null;
  installed: string[];
  downloading: string | null;
  downloadProgress: number | null;
  onDownload: (lang: string) => void;
  onDelete: (lang: string) => void;
  onRefreshModels: () => void;
  onTranslate: () => void;
  onRegenerate: () => void;
}

/** Translation settings dropdown, anchored in the reading view header bar.
 *  These are per-book, one-time preferences, so they live next to the book
 *  title instead of floating over the page. */
export function TranslationSettingsPanel({
  sourceType,
  pdfMethod,
  onPdfMethodChange,
  settings,
  onSettingsChange,
  busy,
  status,
  error,
  hasTranslation,
  model,
  modelsError,
  installed,
  downloading,
  downloadProgress,
  onDownload,
  onDelete,
  onRefreshModels,
  onTranslate,
  onRegenerate,
}: TranslationSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) onRefreshModels();
  }, [open, onRefreshModels]);

  /** Closes the dropdown on outside click or Escape. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isEpub = sourceType === "epub";
  const isOcr = !isEpub && pdfMethod === "ocr";
  const actionLabel = hasTranslation ? "Regenerate translation" : "Translate";
  const modelName = model ? (model.DisplayName ?? model.ModelName ?? "AI model") : null;

  return (
    <div className={styles.anchor} ref={wrapRef}>
      <Button
        variant="icon"
        className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-label="Translation settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Translation settings"
      >
        <Settings2 size={18} strokeWidth={1.8} aria-hidden="true" />
      </Button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Translation settings">
          <header className={styles.header}>
            <span className={styles.headerTitle}>
              <Languages size={15} strokeWidth={1.8} aria-hidden="true" />
              Translation settings
            </span>
            {modelName ? (
              <span className={styles.modelChip}>
                <Bot size={12} strokeWidth={1.8} aria-hidden="true" />
                {modelName}
              </span>
            ) : (
              modelsError && <span className={styles.modelWarning}>No AI model configured</span>
            )}
          </header>

          {!isEpub && (
            <div className={styles.segmented} role="group" aria-label="Translation method">
              <button
                type="button"
                className={`${styles.segment} ${pdfMethod === "ocr" ? styles.segmentActive : ""}`}
                onClick={() => onPdfMethodChange("ocr")}
                aria-pressed={pdfMethod === "ocr"}
              >
                OCR
              </button>
              <button
                type="button"
                className={`${styles.segment} ${pdfMethod === "vision" ? styles.segmentActive : ""}`}
                onClick={() => onPdfMethodChange("vision")}
                aria-pressed={pdfMethod === "vision"}
              >
                AI Vision
              </button>
            </div>
          )}

          {isOcr ? (
            <OcrPanel
              open
              className={styles.ocrEmbed}
              title="OCR languages"
              hint="Pick the languages on the page — multi-language pages need more than one selection. Models are stored locally in the app data tessdata folder."
              installed={installed}
              selected={settings.ocrLangs}
              onSelectedChange={(langs) => onSettingsChange({ ocrLangs: langs })}
              downloading={downloading}
              downloadProgress={downloadProgress}
              onDownload={onDownload}
              onDelete={onDelete}
              onExtract={() => (hasTranslation ? onRegenerate() : onTranslate())}
              extracting={busy}
              status={status ?? error}
              onClose={() => setOpen(false)}
              actionLabel={actionLabel}
              actionBusyLabel="Translating…"
            />
          ) : (
            <div className={styles.fields}>
              <div className={styles.field}>
                <span className={styles.label}>Source language</span>
                <Select
                  compact
                  value={settings.sourceLang}
                  onChange={(event) => onSettingsChange({ sourceLang: event.target.value })}
                  options={[{ value: AUTO_LANGUAGE, label: "Auto-detect" }, ...TRANSLATION_LANGUAGES]}
                  aria-label="Source language"
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Target language</span>
                <Select
                  compact
                  value={settings.targetLang}
                  onChange={(event) => onSettingsChange({ targetLang: event.target.value })}
                  options={TRANSLATION_LANGUAGES}
                  aria-label="Target language"
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Custom instruction</span>
                <TextArea
                  className={styles.prompt}
                  rows={3}
                  value={settings.customPrompt}
                  onChange={(event) => onSettingsChange({ customPrompt: event.target.value })}
                  placeholder={'Optional, e.g. "Explain in simple language", "Convert code examples to C#", "Preserve technical terms"'}
                  aria-label="Custom instruction"
                />
              </div>

              <div className={styles.actions}>
                <Button
                  variant="primary"
                  className={styles.translateButton}
                  onClick={() => (hasTranslation ? onRegenerate() : onTranslate())}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
                      Working…
                    </>
                  ) : hasTranslation ? (
                    <>
                      <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
                      {actionLabel}
                    </>
                  ) : (
                    actionLabel
                  )}
                </Button>
              </div>

              {(status || error) && (
                <p className={error ? styles.errorLine : styles.statusLine} role={error ? "alert" : "status"}>
                  {error ?? status}
                </p>
              )}
            </div>
          )}
        </div>
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
 *  the translation view. Settings live in the header bar dropdown instead. */
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