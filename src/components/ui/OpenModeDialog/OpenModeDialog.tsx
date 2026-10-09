import { FileText, PanelLeft, Square } from "lucide-react";
import { Button } from "../Button/Button";
import { Modal } from "../Modal/Modal";
import styles from "./OpenModeDialog.module.css";

/** How the user wants an externally opened book placed. */
export type OpenMode = "tab" | "window" | "cancel";

interface OpenModeDialogProps {
  /** File name of the OS-opened book, or null when nothing is pending. */
  fileName: string | null;
  onChoose: (mode: OpenMode) => void;
}

/**
 * Asked when a book is opened from outside the app (double-click, "Open
 * with ReadLynx", a second instance's argv). Importing straight away would
 * take the choice away: dropping a book onto a window that already has four
 * tabs open is not what somebody who wants a separate window meant.
 *
 *  Closing the dialog (Escape, the X, the backdrop) is the same as Cancel — an
 *  unasked-for import is worse than no import.
 */
export function OpenModeDialog({ fileName, onChoose }: OpenModeDialogProps) {
  const cancel = () => onChoose("cancel");

  return (
    <Modal
      open={fileName !== null}
      onClose={cancel}
      title="Open this book"
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onChoose("window")}>
            New window
          </Button>
          <Button variant="secondary" onClick={() => onChoose("tab")}>
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
      </div>
    </Modal>
  );
}