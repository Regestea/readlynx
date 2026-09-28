import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "../Button/Button";
import styles from "./Modal.module.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Static footer, pinned below the scrolling body. Omit or pass `null` for a
   *  dialog with no actions. */
  footer?: ReactNode;
  /** Static header, pinned above the scrolling body.
   *
   *  Omit it to keep the default bar carrying the title and the close button.
   *  Pass `null` to drop the bar entirely, for content that should run to the
   *  edges of the dialog. */
  header?: ReactNode;
  wide?: boolean;
  /** Stacks above a dialog that is already open (e.g. an export dialog opened
   *  from the Manage translations dialog). */
  raised?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  header,
  wide = false,
  raised = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const usesDefaultHead = header === undefined;
  const head = usesDefaultHead ? (
    <div className={styles.head}>
      <h2 id="readlynx-modal-title" className={styles.title}>
        {title}
      </h2>
      <Button variant="icon" className={styles.close} onClick={onClose} aria-label="Close dialog">
        <X size={18} strokeWidth={1.8} aria-hidden="true" />
      </Button>
    </div>
  ) : header === null ? null : (
    <div className={styles.head}>{header}</div>
  );

  return createPortal(
    <div
      className={raised ? `${styles.overlay} ${styles.overlayRaised}` : styles.overlay}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        // A custom header has no `#readlynx-modal-title` to point at, so the
        // dialog is named directly instead of leaving the reference dangling.
        aria-labelledby={usesDefaultHead ? "readlynx-modal-title" : undefined}
        aria-label={usesDefaultHead ? undefined : title}
        className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {head}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
