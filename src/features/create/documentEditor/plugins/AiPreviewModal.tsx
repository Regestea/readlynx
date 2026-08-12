import { Check, X } from "lucide-react";
import { Button } from "../../../../components/ui/Button/Button";
import { Markdown } from "../../../../components/markdown/Markdown";
import { Modal } from "../../../../components/ui/Modal/Modal";
import styles from "../DocumentEditor.module.css";

interface AiPreviewModalProps {
  selectionText: string | null;
  response: string;
  onAccept: () => void;
  onIgnore: () => void;
}

/** Preview of an AI suggestion before it touches the document. Shows what will
 *  be replaced (if a selection exists) and the rendered markdown response. */
export function AiPreviewModal({ selectionText, response, onAccept, onIgnore }: AiPreviewModalProps) {
  return (
    <Modal
      open
      onClose={onIgnore}
      title="AI suggestion"
      footer={
        <>
          <Button variant="secondary" onClick={onIgnore}>
            <X size={15} strokeWidth={2} aria-hidden="true" />
            Ignore
          </Button>
          <Button onClick={onAccept}>
            <Check size={15} strokeWidth={2} aria-hidden="true" />
            Apply
          </Button>
        </>
      }
    >
      {selectionText && (
        <div className={styles.aiPreviewBlock}>
          <span className={styles.aiPreviewLabel}>Replacing selection</span>
          <div className={styles.aiPreviewOriginal}>{selectionText}</div>
        </div>
      )}
      <div className={styles.aiPreviewBlock}>
        <span className={styles.aiPreviewLabel}>
          {selectionText ? "AI response" : "Will be added to the document"}
        </span>
        <div className={styles.aiPreviewBody}>
          <Markdown content={response} />
        </div>
      </div>
    </Modal>
  );
}
