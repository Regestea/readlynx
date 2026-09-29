import { useState } from "react";
import { CheckCircle2, Download, Loader2, ScanText, Search, Sparkles, Trash2, X } from "lucide-react";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { Button } from "../ui/Button/Button";
import { CustomInstructionSelect } from "../customInstruction/CustomInstructionSelect";
import { OCR_LANGUAGES } from "../../infrastructure/ocr/ocrLanguages";
import styles from "./OcrPanel.module.css";

export type ExtractMode = "ocr" | "vision";

interface OcrPanelProps {
  open: boolean;
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
  /** Runs the action shown in the footer (e.g. extract the page text or
   *  translate the page). When omitted, the panel becomes a language-only
   *  picker: no footer is rendered at all. */
  onExtract?: () => void;
  extracting: boolean;
  /** Status line shown in the footer (progress / errors / info). */
  status?: string | null;
  /** Extraction pipeline shown in the panel: local OCR (language models) or
   *  AI vision (the page image is handed to the AI, which detects the
   *  language itself — no language selection is offered). */
  mode?: ExtractMode;
  /** When provided, shows the OCR / AI vision toggle at the top. */
  onModeChange?: (mode: ExtractMode) => void;
  /** User instructions for the AI vision extraction (structure, notes,
   *  anything). Optional — when omitted, no instruction box is shown. */
  instruction?: string;
  onInstructionChange?: (value: string) => void;
  /** Id of the saved instruction template chosen for the extraction ("" =
   *  none). Optional — when provided together with `onInstructionIdChange`,
   *  a "Custom instruction" select (saved templates + manage) is shown above
   *  the instruction box. */
  instructionId?: string;
  onInstructionIdChange?: (id: string) => void;
  onClose: () => void;
  /** Overrides the panel header title (e.g. "OCR source languages"). */
  title?: string;
  /** Overrides the helper text under the header (e.g. translation use). */
  hint?: string;
  /** Overrides the primary button label (e.g. "Translate page"). */
  actionLabel?: string;
  /** Overrides the busy button label. */
  actionBusyLabel?: string;
  /** Extra classes on the panel root (used to embed it in other popovers). */
  className?: string;
}

export function OcrPanel({
  open,
  installed,
  selected,
  onSelectedChange,
  downloading,
  downloadProgress,
  onDownload,
  onDelete,
  onExtract,
  extracting,
  status,
  mode = "ocr",
  onModeChange,
  instruction = "",
  onInstructionChange,
  instructionId,
  onInstructionIdChange,
  onClose,
  title = "Extract text (OCR)",
  hint,
  actionLabel = "Extract page text",
  actionBusyLabel = "Recognizing…",
  className = "",
}: OcrPanelProps) {
  const [query, setQuery] = useState("");
  if (!open) return null;

  const isVision = mode === "vision";
  const installedSet = new Set(installed);
  const selectedSet = new Set(selected);
  const missingModels = selected.some((lang) => !installedSet.has(lang));
  // AI vision needs no language model — the model detects the language of
  // the page itself.
  const canExtract = isVision
    ? Boolean(onExtract) && !extracting
    : selected.length > 0 && !missingModels && !extracting;

  const toggleLang = (code: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(code);
    else next.delete(code);
    onSelectedChange(Array.from(next));
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleLanguages = normalizedQuery
    ? OCR_LANGUAGES.filter(
        (lang) => lang.label.toLowerCase().includes(normalizedQuery) || lang.code.includes(normalizedQuery),
      )
    : OCR_LANGUAGES;

  return (
    <div
      className={`${styles.panel} pdf-toolbar-popover ${className}`}
      role="dialog"
      aria-label={isVision ? "AI vision text extraction" : "OCR text extraction"}
    >
      <header className={styles.header}>
        <span className={styles.headerTitle}>
          <ScanText size={15} strokeWidth={1.8} aria-hidden="true" />
          {title}
        </span>
        <Button
          variant="icon"
          className={styles.close}
          onClick={onClose}
          aria-label="Close OCR panel"
        >
          <X size={15} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </header>

      {onModeChange && (
        <div className={styles.modeSwitch} role="group" aria-label="Extraction method">
          <button
            type="button"
            className={`${styles.modeButton} ${!isVision ? styles.modeButtonActive : ""}`}
            onClick={() => onModeChange("ocr")}
            aria-pressed={!isVision}
          >
            <ScanText size={13} strokeWidth={1.8} aria-hidden="true" />
            OCR
          </button>
          <button
            type="button"
            className={`${styles.modeButton} ${isVision ? styles.modeButtonActive : ""}`}
            onClick={() => onModeChange("vision")}
            aria-pressed={isVision}
          >
            <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
            AI vision
          </button>
        </div>
      )}

      <p className={styles.hint}>
        {isVision
          ? hint ??
            "Send the current page as an image to your AI model, which reads the text and preserves its structure (headings, lists, tables) as Markdown. No language selection is needed — the model detects the language itself."
          : hint ??
            `Recognize the current page and insert its text into the editor. Pick one or more languages — models are stored locally in the app data tessdata folder.`}
      </p>

      {isVision && onInstructionChange && (
        <div className={styles.visionInstructions}>
          {onInstructionIdChange && (
            <CustomInstructionSelect
              compact
              value={instructionId ?? ""}
              onChange={onInstructionIdChange}
              onPicked={(instruction) => onInstructionChange(instruction?.content ?? "")}
              onInstructionEdited={(instruction) => {
                if (instruction.id === instructionId) onInstructionChange(instruction.content);
              }}
              disabled={extracting}
              ariaLabel="Custom instruction for the extraction"
              title="Saved instruction template layered on the extraction"
            />
          )}
          <textarea
            className={styles.instructionBox}
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder="Instructions for the extraction — e.g. “join broken lines into paragraphs”, “keep all headings as headings”, “ignore page numbers”…"
            rows={3}
            disabled={extracting}
            aria-label="Extraction instructions"
          />
        </div>
      )}

      {!isVision && (
        <div className={styles.searchBox}>
          <Search size={13} strokeWidth={1.8} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${OCR_LANGUAGES.length} languages…`}
            aria-label="Filter languages"
          />
        </div>
      )}

      {!isVision && (
        <ul className={styles.langList}>
          {visibleLanguages.map((lang) => {
            const isInstalled = installedSet.has(lang.code);
            const isDownloading = downloading === lang.code;
            return (
              <li key={lang.code} className={styles.langRow} title={lang.label}>
                <Checkbox
                  checked={selectedSet.has(lang.code)}
                  onChange={(checked) => toggleLang(lang.code, checked)}
                  label={lang.label}
                  disabled={extracting}
                />
                {isDownloading ? (
                  <span className={styles.downloading} role="status">
                    <Loader2 size={13} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
                    {downloadProgress != null ? `${Math.round(downloadProgress * 100)}%` : "…"}
                  </span>
                ) : isInstalled ? (
                  <span className={styles.installed}>
                    <CheckCircle2 size={13} strokeWidth={2} aria-hidden="true" />
                    Installed
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    className={styles.downloadButton}
                    onClick={() => onDownload(lang.code)}
                  >
                    <Download size={13} strokeWidth={1.8} aria-hidden="true" />
                    Download
                  </Button>
                )}
                {isInstalled && !isDownloading && (
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => onDelete(lang.code)}
                    aria-label={`Delete ${lang.label} model`}
                    title="Delete model file"
                  >
                    <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!isVision && visibleLanguages.length === 0 && (
        <p className={styles.noResults}>No languages match “{query.trim()}”.</p>
      )}

      {!isVision && downloading && (
        <div className={styles.progressTrack} aria-hidden="true">
          <div
            className={styles.progressFill}
            style={{ width: `${Math.round((downloadProgress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      {onExtract && (
        <footer className={styles.footer}>
          <span className={styles.status} role="status">
            {status ?? ""}
          </span>
          <Button
            variant="primary"
            className={styles.extractButton}
            onClick={onExtract}
            disabled={!canExtract}
          >
            {extracting && (
              <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
            )}
            {isVision ? (
              <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <ScanText size={14} strokeWidth={1.8} aria-hidden="true" />
            )}
            {extracting ? (isVision ? "Analyzing…" : actionBusyLabel) : isVision ? "Extract with AI vision" : actionLabel}
          </Button>
        </footer>
      )}
    </div>
  );
}
