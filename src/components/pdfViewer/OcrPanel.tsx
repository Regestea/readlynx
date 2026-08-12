import { useState } from "react";
import { CheckCircle2, Download, Loader2, ScanText, Search, Trash2, X } from "lucide-react";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { Button } from "../ui/Button/Button";
import { OCR_LANGUAGES } from "../../infrastructure/ocr/ocrLanguages";
import styles from "./OcrPanel.module.css";

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
  /** Runs OCR on the current page. */
  onExtract: () => void;
  extracting: boolean;
  /** Status line shown in the footer (progress / errors / info). */
  status: string | null;
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
  onClose,
  title = "Extract text (OCR)",
  hint,
  actionLabel = "Extract page text",
  actionBusyLabel = "Recognizing…",
  className = "",
}: OcrPanelProps) {
  const [query, setQuery] = useState("");
  if (!open) return null;

  const installedSet = new Set(installed);
  const selectedSet = new Set(selected);
  const missingModels = selected.some((lang) => !installedSet.has(lang));
  const canExtract = selected.length > 0 && !missingModels && !extracting;

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
    <div className={`${styles.panel} ${className}`} role="dialog" aria-label="OCR text extraction">
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

      <p className={styles.hint}>
        {hint ??
          `Recognize the current page and insert its text into the editor. Pick one or more languages — models are stored locally in the app data tessdata folder.`}
      </p>

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

      <ul className={styles.langList}>
        {visibleLanguages.map((lang) => {
          const isInstalled = installedSet.has(lang.code);
          const isDownloading = downloading === lang.code;
          return (
            <li key={lang.code} className={styles.langRow}>
              <Checkbox
                checked={selectedSet.has(lang.code)}
                onChange={(checked) => toggleLang(lang.code, checked)}
                label={lang.label}
                disabled={extracting}
              />
              <span className={styles.langCode}>{lang.code}</span>
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
      {visibleLanguages.length === 0 && (
        <p className={styles.noResults}>No languages match “{query.trim()}”.</p>
      )}

      {downloading && (
        <div className={styles.progressTrack} aria-hidden="true">
          <div
            className={styles.progressFill}
            style={{ width: `${Math.round((downloadProgress ?? 0) * 100)}%` }}
          />
        </div>
      )}

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
          <ScanText size={14} strokeWidth={1.8} aria-hidden="true" />
          {extracting ? actionBusyLabel : actionLabel}
        </Button>
      </footer>
    </div>
  );
}
