import { useState } from "react";
import { Loader2, ScanText, Sparkles } from "lucide-react";
import { Select } from "../ui/Select/Select";
import { useAiModelList } from "../../infrastructure/ai/useAiModelList";
import styles from "./CopyPageTextMenu.module.css";

/** How a page's text is turned into something worth copying. */
export type CopyPageTextMode = "ocr" | "vision";

interface CopyPageTextMenuProps {
  open: boolean;
  onCopy: (payload: { mode: CopyPageTextMode; modelId: string }) => void;
  /** Mode currently running, so its row can show the spinner and both rows
   *  can be locked. */
  busyMode: CopyPageTextMode | null;
  /** True when a scan region is set, which the menu says out loud because it
   *  silently narrows what ends up on the clipboard. */
  regionSet: boolean;
}

/** Toolbar dropdown that copies the current page's text, either by running OCR
 *  locally or by handing the page image to the AI and copying the Markdown it
 *  returns. Both paths read the same scan-region capture the extract panel
 *  uses, so a region chosen once applies to the copy too.
 *
 *  The AI row carries its own model picker: a page can be a cheap one to
 *  recognize and an expensive one to read as Markdown, and the reader is the
 *  only one who knows which this page deserves. The choice is per menu and
 *  never persisted — the app default is the pick each time the menu opens,
 *  the same contract as the chat panel's per-conversation model.
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
}: CopyPageTextMenuProps) {
  const { models, defaultModel, error: modelsError } = useAiModelList();
  const [selectedModelId, setSelectedModelId] = useState("");
  const activeModel = models.find((entry) => entry.Id === selectedModelId) ?? defaultModel;

  if (!open) return null;

  const busy = busyMode !== null;
  /** No usable model means the AI row can only fail, so it is disabled with
   *  the reason right under it instead of erroring after the wait. */
  const aiBlocked = activeModel === null;

  return (
    <div className={`${styles.menu} pdf-toolbar-popover`} role="menu" aria-label="Copy page text">
      <p className={styles.hint}>
        {regionSet
          ? "Only the scan region of this page is copied."
          : "The whole page is copied. Set a scan region to narrow it down."}
      </p>
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
  );
}