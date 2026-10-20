import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, FileCode, FileText, FolderInput } from "lucide-react";
import { Card } from "../../../components/ui/Card/Card";
import { Switch } from "../../../components/ui/Switch/Switch";
import styles from "./fileImport.module.css";

/** The three per-file-type "add to library" switches (AppSettings columns). */
type AddKey = "openWithAddPdf" | "openWithAddEpub" | "openWithAddMarkdown";

interface OptionRow {
  key: AddKey;
  icon: ReactNode;
  label: string;
  hint: string;
}

const OPTIONS: OptionRow[] = [
  {
    key: "openWithAddPdf",
    icon: <FileText size={15} strokeWidth={1.8} />,
    label: "Add PDFs to the library",
    hint: "Off instead opens them as temporary files — read while the app runs, removed when it closes.",
  },
  {
    key: "openWithAddEpub",
    icon: <BookOpen size={15} strokeWidth={1.8} />,
    label: "Add EPUBs to the library",
    hint: "Off instead opens them as temporary files — read while the app runs, removed when it closes.",
  },
  {
    key: "openWithAddMarkdown",
    icon: <FileCode size={15} strokeWidth={1.8} />,
    label: "Add Markdown files to the library",
    hint: "Off instead opens them as temporary files — read while the app runs, removed when it closes.",
  },
];

const OFF: Record<AddKey, boolean> = {
  openWithAddPdf: true,
  openWithAddEpub: true,
  openWithAddMarkdown: true,
};

/** How externally opened books are placed: one switch per file type. When a
 *  type's switch is off, its files open as session-only books — they read
 *  like any other book but never appear on the shelf and the background
 *  worker removes them at the next launch. */
export function FileImportCard() {
  const [toggles, setToggles] = useState<Record<AddKey, boolean>>(OFF);

  useEffect(() => {
    let cancelled = false;
    void window.readlynx?.db
      .getAppSettings()
      .then((settings) => {
        if (cancelled || !settings) return;
        setToggles({
          openWithAddPdf: settings.openWithAddPdf,
          openWithAddEpub: settings.openWithAddEpub,
          openWithAddMarkdown: settings.openWithAddMarkdown,
        });
      })
      .catch(() => {
        // No bridge — the defaults are already on display.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setToggleValue = useCallback((key: AddKey, value: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: value }));
    const patch: Partial<Record<AddKey, boolean>> = { [key]: value };
    void window.readlynx?.db.updateAppSettings(patch).catch(() => false);
  }, []);

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <FolderInput size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>File import</h2>
        </div>
        <p className={styles.sectionDesc}>
          When a file is opened from the system file explorer (double-click or “Open with
          ReadLynx”), these switches seed the open prompt&apos;s keep-in-library choice per type.
          A type starting with the switch off opens as a temporary file — readable while the app
          is running, never on the shelf, removed when the app closes — but each single open can
          still be kept from the prompt.
        </p>
      </div>

      <div className={styles.optionList}>
        {OPTIONS.map((option) => (
          <div key={option.key} className={styles.optionRow}>
            <div className={styles.optionText}>
              <span className={styles.optionLabel}>
                <span className={styles.optionIcon} aria-hidden="true">
                  {option.icon}
                </span>
                {option.label}
              </span>
              <span className={styles.optionDesc}>{option.hint}</span>
            </div>
            <Switch
              checked={toggles[option.key]}
              onChange={(value) => setToggleValue(option.key, value)}
              ariaLabel={option.label}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
