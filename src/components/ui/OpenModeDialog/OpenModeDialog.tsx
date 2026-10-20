import { useState } from "react";
import { FileText, PanelLeft, Square } from "lucide-react";
import { Button } from "../Button/Button";
import { Checkbox } from "../Checkbox/Checkbox";
import { Modal } from "../Modal/Modal";
import styles from "./OpenModeDialog.module.css";

/** How the user wants an externally opened book placed. */
export type OpenMode = "tab" | "window" | "cancel";

/** The dialog's full answer: where the book opens, and whether a new import
 *  should join the library (keep it) or stay a session-only copy. */
export interface OpenModeAnswer {
  mode: OpenMode;
  addToLibrary: boolean;
}

interface OpenModeDialogProps {
  /** File name of the OS-opened book, or null when nothing is pending. */
  fileName: string | null;
  /** The file type's add-to-library switch — the checkbox's default. */
  defaultAddToLibrary?: boolean;
  onChoose: (answer: OpenModeAnswer) => void;
}

/**
 * Asked when a book is opened from outside the app (double-click, "Open
 * with ReadLynx", a second instance's argv). Importing straight away would
 * take the choice away: dropping a book onto a window that already has four
 * tabs open is not what somebody who wants a separate window meant.
 *
 * The checkbox seeds from the file type's "add to library" switch in
 * Settings → File import and lets each single open deviate from it —
 * unchecked, the file only sits open for this session without entering the
 * library.
 *
 *  Closing the dialog (Escape, the X, the backdrop) is the same as Cancel — an
 *  unasked-for import is worse than no import.
 */
export function OpenModeDialog({ fileName, defaultAddToLibrary = true, onChoose }: OpenModeDialogProps) {
  // Own state, seeded once per prompt: choosing stays per-file and never
  // writes the Settings switch back.
  const [addToLibrary, setAddToLibrary] = useState(defaultAddToLibrary);
  const choose = (mode: OpenMode) => onChoose({ mode, addToLibrary });

  return (
    <Modal
      open={fileName !== null}
      onClose={() => choose("cancel")}
      title="Open this book"
      footer={
        <>
          <Button variant="secondary" onClick={() => choose("cancel")}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => choose("window")}>
            New window
          </Button>
          <Button variant="secondary" onClick={() => choose("tab")}>
            Open as tab
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <FileText size={28} strokeWidth={1.6} aria-hidden="true" />
        <p className={styles.name}>{fileName}</p>
        <ul className={styles.options}>
          <li className={styles.option}>
            <PanelLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>Add a tab to this window, next to the books you already have open.</span>
          </li>
          <li className={styles.option}>
            <Square size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>Open a separate window, so you can read it beside this one.</span>
          </li>
        </ul>
        <label className={styles.saveRow}>
          <Checkbox checked={addToLibrary} onChange={setAddToLibrary} />
          <span className={styles.saveLabel}>
            <span className={styles.saveTitle}>Add this file to the library</span>
            <span className={styles.saveHint}>
              Unchecked files open as a temporary copy for this session — never on the shelf,
              removed when the app closes.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
