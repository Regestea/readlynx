import { useEffect, useState } from "react";
import { ChevronDown, Languages, Loader2, ScanText, Sparkles } from "lucide-react";
import { Select } from "../ui/Select/Select";
import { useAiModelList } from "../../infrastructure/ai/useAiModelList";
import { ocrLanguagesLabel } from "../../features/reading/translation/languages";
import { OcrPanel } from "./OcrPanel";
import styles from "./CopyPageTextMenu.module.css";

/** How a page's text is turned into something worth copying. */
export type CopyPageTextMode = "ocr" | "vision";

/** OCR language state for the menu's language picker, owned by the host — the
 *  same settings the translate panel reads and writes, so a language picked
 *  here is the language the translate panel uses and the other way around. */
export interface CopyMenuOcrLanguages {
  /** Language codes that have a model downloaded on disk. */
  installed: string[];
  /** Currently selected languages (checked). */
  selected: string[];
  onSelectedChange: (langs: string[]) => void;
  /** Language code currently being downloaded (shows a progress bar). */
  downloading: string | null;
  downloadProgress: number | null;
  onDownload: (lang: string) => void;
  onDelete: (lang: string) => void;
}

interface CopyPageTextMenuProps {
  open: boolean;
  onCopy: (payload: { mode: CopyPageTextMode; modelId: string }) => void;
  /** Mode currently running, so its row can show the spinner and both rows
   *  can be locked. */
  busyMode: CopyPageTextMode | null;
  /** True when a scan region is set, which the menu says out loud because it
   *  silently narrows what ends up on the clipboard. */
  regionSet: boolean;
  /** When provided, the OCR box grows an "OCR languages" button that opens
   *  the language picker right in the menu. Omit in previews. */
  ocrLanguages?: CopyMenuOcrLanguages;
}

/** Toolbar dropdown that copies the current page's text, either by running OCR
 *  locally or by handing the page image to the AI and copying the Markdown it
 *  returns. Both paths read the same scan-region capture the extract panel
 *  uses, so a region chosen once applies to the copy too.
 *
 *  The menu is two boxed sections. The Vision box carries the AI row and its
 *  own model picker: a page can be a cheap one to recognize and an expensive
 *  one to read as Markdown, and the reader is the only one who knows which
 *  this page deserves. The choice is per menu and never persisted — the app
 *  default is the pick each time the menu opens, the same contract as the
 *  chat panel's per-conversation model. The OCR box carries the local row and
 *  an "OCR languages" button that opens the language picker right here, so
 *  picking the page language never requires a detour through the translate
 *  panel in the top bar.
 *
 *  Stays open while a copy fails — the error arrives as a notification and
 *  the menu is still the thing the reader was aiming at, so they can pick the
 *  other method right away. The owner closes it on outside click, on Escape
 *  and once a copy succeeds. */
export function CopyPageTextMenu({
  open,
  onCopy,
  busyMode,
  regionSet,
  ocrLanguages,
}: CopyPageTextMenuProps) {
  const { models, defaultModel, error: modelsError } = useAiModelList();
  const [selectedModelId, setSelectedModelId] = useState("");
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const activeModel = models.find((entry) => entry.Id === selectedModelId) ?? defaultModel;

  /** Escape closes the language picker first and the menu second. This runs
   *  in the capture phase, ahead of the owner's bubble-phase menu handler, so
   *  one press never skips a level. */
  useEffect(() => {
    if (!langPickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setLangPickerOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [langPickerOpen]);

  if (!open) return null;

  const busy = busyMode !== null;
  /** No usable model means the AI row can only fail, so it is disabled with
   *  the reason right under it instead of erroring after the wait. */
  const aiBlocked = activeModel === null;
  const selectedLangs = ocrLanguages?.selected ?? [];

  return (
    <div className={`${styles.menu} pdf-toolbar-popover`} role="menu" aria-label="Copy page text">
      <p className={styles.hint}>
        {regionSet
          ? "Only the scan region of this page is copied."
          : "The whole page is copied. Set a scan region to narrow it down."}
      </p>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Vision</p>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => onCopy({ mode: "vision", modelId: activeModel?.Id ?? "" })}
          disabled={busy || aiBlocked}
        >
          <span className={styles.itemIcon} aria-hidden="true">
            {busyMode === "vision" ? (
              <Loader2 size={15} strokeWidth={2} className={styles.spinner} />
            ) : (
              <Sparkles size={15} strokeWidth={1.8} />
            )}
          </span>
          <span className={styles.itemText}>
            <span className={styles.itemLabel}>Copy with AI</span>
            <span className={styles.itemDesc}>Markdown, keeping the page structure</span>
          </span>
        </button>
        {aiBlocked ? (
          <p className={styles.blocked}>{modelsError ?? "No AI model configured."}</p>
        ) : (
          models.length > 1 && (
            <label className={styles.modelPicker}>
              <span className={styles.modelLabel}>Model</span>
              <Select
                compact
                value={activeModel?.Id ?? ""}
                onChange={(event) => setSelectedModelId(event.target.value)}
                disabled={busy}
                options={models.map((entry) => ({
                  value: entry.Id,
                  label: entry.DisplayName ?? entry.ModelName ?? entry.Provider,
                }))}
                aria-label="Model used to copy the page with AI"
                title="Model used for the AI copy"
              />
            </label>
          )
        )}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>OCR</p>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => onCopy({ mode: "ocr", modelId: "" })}
          disabled={busy}
        >
          <span className={styles.itemIcon} aria-hidden="true">
            {busyMode === "ocr" ? (
              <Loader2 size={15} strokeWidth={2} className={styles.spinner} />
            ) : (
              <ScanText size={15} strokeWidth={1.8} />
            )}
          </span>
          <span className={styles.itemText}>
            <span className={styles.itemLabel}>Copy with OCR</span>
            <span className={styles.itemDesc}>Plain text, recognized locally</span>
          </span>
        </button>
        {ocrLanguages && (
          <div className={styles.langAnchor}>
            <button
              type="button"
              className={`${styles.langTrigger} ${langPickerOpen ? styles.langTriggerActive : ""}`}
              onClick={() => setLangPickerOpen((current) => !current)}
              disabled={busy}
              aria-expanded={langPickerOpen}
              aria-haspopup="dialog"
              title="Languages the local OCR recognizes"
            >
              <Languages size={14} strokeWidth={1.8} aria-hidden="true" />
              <span className={styles.langSummary}>
                {selectedLangs.length > 0
                  ? ocrLanguagesLabel(selectedLangs)
                  : "No language picked"}
              </span>
              <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {langPickerOpen && (
              <OcrPanel
                open
                title="OCR languages"
                hint="Pick the languages on the page — multi-language pages need more than one selection. Models are stored locally in the app data tessdata folder."
                installed={ocrLanguages.installed}
                selected={selectedLangs}
                onSelectedChange={ocrLanguages.onSelectedChange}
                downloading={ocrLanguages.downloading}
                downloadProgress={ocrLanguages.downloadProgress}
                onDownload={ocrLanguages.onDownload}
                onDelete={ocrLanguages.onDelete}
                extracting={busy}
                onClose={() => setLangPickerOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
