import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button/Button";
import { Modal } from "../../../components/ui/Modal/Modal";
import styles from "./PageRangeModal.module.css";

interface PageRangeModalProps {
  open: boolean;
  onClose: () => void;
  /** Total pages of the document (0 while unknown). */
  pageCount: number;
  busy: boolean;
  /** Human-readable summary of the toolbar settings applied to the range. */
  methodLabel: string;
  targetLabel: string;
  modelLabel: string;
  onTranslate: (from: number, to: number) => void;
}

/** Lets the user pick a page range with a single dual-thumb slider (start
 *  and end points, bounded by the document's page count) and translate every
 *  page in order with the settings chosen in the header bar toolbar. */
export function PageRangeModal({
  open,
  onClose,
  pageCount,
  busy,
  methodLabel,
  targetLabel,
  modelLabel,
  onTranslate,
}: PageRangeModalProps) {
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);

  /** Seeds the slider with the whole document (1 → last page) every time the
   *  modal opens — or when the page count arrives while it is already open
   *  (render-time reset, the recommended alternative to an effect). */
  const [seededOpen, setSeededOpen] = useState(false);
  const [seededCount, setSeededCount] = useState(0);
  if (open !== seededOpen || (open && pageCount > 0 && seededCount === 0)) {
    setSeededOpen(open);
    if (open) {
      setSeededCount(pageCount);
      setFrom(1);
      setTo(pageCount > 0 ? pageCount : 1);
    }
  }

  const maxPage = Math.max(1, pageCount);
  const count = to - from + 1;
  const ready = pageCount > 0 && !busy;
  const span = Math.max(1, maxPage - 1);
  const leftPct = ready ? ((from - 1) / span) * 100 : 0;
  const rightPct = ready ? ((to - 1) / span) * 100 : 0;
  // When both thumbs sit on the last page, the “to” thumb must be on top so
  // the user can still pull it back down; otherwise “from” wins the overlap.
  const fromZ = from === maxPage ? 1 : 2;
  const toZ = from === maxPage ? 3 : 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Translate page range"
      footer={
        <Button
          variant="primary"
          className={styles.footerButton}
          onClick={() => onTranslate(from, to)}
          disabled={busy || pageCount === 0}
        >
          {busy ? (
            <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
          ) : null}
          {busy
            ? "Working…"
            : `Translate ${count} page${count === 1 ? "" : "s"}`}
        </Button>
      }
    >
      <p className={styles.hint}>
        Translates every page from start to end, in order, with the settings picked in the
        toolbar above: {methodLabel}, target {targetLabel}
        {modelLabel ? `, model ${modelLabel}` : ""}. Pages already translated are regenerated.
      </p>

      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <span className={styles.fieldLabel}>Page range</span>
          <span className={styles.value}>
            {from} – {to}
          </span>
        </div>
        <div className={styles.sliderArea}>
          <div className={styles.track} aria-hidden="true" />
          <div
            className={styles.trackHighlight}
            aria-hidden="true"
            style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
          />
          <input
            type="range"
            min={1}
            max={maxPage}
            value={from}
            onChange={(event) => {
              const next = Number(event.target.value);
              setFrom(next);
              // Keep the range valid: pulling “from” past “to” drags “to” along.
              if (next > to) setTo(next);
            }}
            disabled={!ready}
            aria-label="First page of the range"
            className={styles.slider}
            style={{ zIndex: fromZ }}
          />
          <input
            type="range"
            min={1}
            max={maxPage}
            value={to}
            onChange={(event) => {
              const next = Number(event.target.value);
              setTo(next);
              // Keep the range valid: pulling “to” before “from” drags “from” along.
              if (next < from) setFrom(next);
            }}
            disabled={!ready}
            aria-label="Last page of the range"
            className={styles.slider}
            style={{ zIndex: toZ }}
          />
        </div>
      </div>

      <p className={styles.pageCount}>
        {pageCount > 0
          ? `The document has ${pageCount} pages — ${count} page${count === 1 ? "" : "s"} selected.`
          : "The page count is not available yet."}
      </p>
    </Modal>
  );
}