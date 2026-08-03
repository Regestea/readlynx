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
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, footer, wide = false }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="readlynx-modal-title"
        className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 id="readlynx-modal-title" className={styles.title}>
            {title}
          </h2>
          <Button variant="icon" className={styles.close} onClick={onClose} aria-label="Close dialog">
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
