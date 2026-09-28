import { useState } from "react";
import { Modal } from "../../../../components/ui/Modal/Modal";
import { Button } from "../../../../components/ui/Button/Button";
import { NumberInput } from "../../../../components/ui/NumberInput/NumberInput";
import { PAGE_FORMATS, marginPx } from "../constants";
import type { PageFormat, PageMargins } from "../constants";
import { clampInches, INCH_MAX, INCH_MIN, toInches, toMm } from "../../../../components/export/marginUnits";
import styles from "./MarginDialog.module.css";

const PREVIEW_WIDTH = 236;

interface MarginDialogProps {
  open: boolean;
  onClose: () => void;
  format: PageFormat;
  margins: PageMargins;
  onApply: (margins: PageMargins) => void;
}

const SIDES: { key: keyof PageMargins; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
];

export function MarginDialog({ open, onClose, format, margins, onApply }: MarginDialogProps) {
  const [draft, setDraft] = useState<PageMargins>({
    top: toInches(margins.top),
    right: toInches(margins.right),
    bottom: toInches(margins.bottom),
    left: toInches(margins.left),
  });

  const { width, height } = PAGE_FORMATS[format];
  const previewHeight = Math.round((PREVIEW_WIDTH * height) / width);
  const scale = PREVIEW_WIDTH / width;

  const normalized: PageMargins = {
    top: clampInches(draft.top),
    right: clampInches(draft.right),
    bottom: clampInches(draft.bottom),
    left: clampInches(draft.left),
  };

  const patch = (side: keyof PageMargins) => (value: number) => {
    setDraft((prev) => ({ ...prev, [side]: value }));
  };

  const apply = () =>
    onApply({
      top: toMm(normalized.top),
      right: toMm(normalized.right),
      bottom: toMm(normalized.bottom),
      left: toMm(normalized.left),
    });

  const inset = {
    top: marginPx(toMm(normalized.top)) * scale,
    right: marginPx(toMm(normalized.right)) * scale,
    bottom: marginPx(toMm(normalized.bottom)) * scale,
    left: marginPx(toMm(normalized.left)) * scale,
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom margins"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.preview}>
          <div
            className={styles.previewPage}
            style={{ width: PREVIEW_WIDTH, height: previewHeight }}
            aria-hidden="true"
          >
            <div
              className={styles.previewContent}
              style={{
                top: inset.top,
                right: inset.right,
                bottom: inset.bottom,
                left: inset.left,
              }}
            >
              <span className={styles.previewLine} style={{ width: "72%" }} />
              <span className={styles.previewLine} style={{ width: "92%" }} />
              <span className={styles.previewLine} style={{ width: "84%" }} />
              <span className={styles.previewLine} style={{ width: "64%" }} />
            </div>
            <span
              className={`${styles.previewLabel} ${styles.previewLabelTop}`}
              style={{ top: inset.top / 2 }}
            >
              Top
            </span>
            <span
              className={`${styles.previewLabel} ${styles.previewLabelBottom}`}
              style={{ bottom: inset.bottom / 2 }}
            >
              Bottom
            </span>
            <span
              className={`${styles.previewLabel} ${styles.previewLabelLeft}`}
              style={{ left: inset.left / 2 }}
            >
              Left
            </span>
            <span
              className={`${styles.previewLabel} ${styles.previewLabelRight}`}
              style={{ right: inset.right / 2 }}
            >
              Right
            </span>
          </div>
        </div>

        <div className={styles.grid}>
          {SIDES.map(({ key, label }) => (
            <div
              key={key}
              className={`${styles.field} ${styles[`field${label}`]}`}
            >
              <label className={styles.label} htmlFor={`readlynx-margin-${key}`}>
                {label} (in)
              </label>
              <NumberInput
                id={`readlynx-margin-${key}`}
                value={draft[key]}
                onChange={patch(key)}
                min={INCH_MIN}
                max={INCH_MAX}
                step={0.1}
                label={`${label} margin`}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
