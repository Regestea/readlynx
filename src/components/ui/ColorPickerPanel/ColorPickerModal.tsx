import { useState } from "react";
import { ColorArea } from "./ColorArea";
import { isCompleteHex } from "./colorMath";
import { READING_BACKGROUNDS } from "./colors";
import { Button } from "../Button/Button";
import { Modal } from "../Modal/Modal";
import styles from "./ColorPickerModal.module.css";

interface ColorPickerModalProps {
  /** Dialog title, e.g. "Pick text color". */
  title: string;
  /** The color currently in effect. The dialog edits a draft of it and only
   *  writes on Apply, so Cancel really cancels. */
  value: string;
  /** Extra curated swatches shown under the picker, on top of the reading
   *  backgrounds every color dialog in the app offers. */
  presets?: readonly string[];
  /** Receives the picked color; the caller closes the dialog. */
  onApply: (color: string) => void;
  /** Dismissed without changing anything (Cancel, Escape, overlay, ×). */
  onClose: () => void;
}

/**
 * The full color dialog shared by every color entry point in the app: the
 * curated swatches first, then the saturation/value square, hue bar and hex
 * field.
 *
 * Mount it only while it is open so each visit starts from the applied color:
 * the draft lives in this component's state, and nothing is written anywhere
 * until Apply.
 */
export function ColorPickerModal({
  title,
  value,
  presets = [],
  onApply,
  onClose,
}: ColorPickerModalProps) {
  /** Mid grey rather than black when there is no color yet: the handles would
   *  otherwise sit on the black corner of the SV square. */
  const [draft, setDraft] = useState(() => value || "#808080");

  const grid = Array.from(
    new Map(
      [...READING_BACKGROUNDS.map(({ color }) => color), ...presets]
        .filter(Boolean)
        .map((color) => [color.toLowerCase(), color]),
    ).values(),
  );
  const applyable = isCompleteHex(draft);

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => applyable && onApply(draft)}
            disabled={!applyable}
            title={applyable ? undefined : "Enter a complete hex color"}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.grid} role="radiogroup" aria-label={`${title} presets`}>
        {grid.map((color) => {
          const active = draft.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={color}
              title={color}
              className={`${styles.swatch} ${active ? styles.swatchActive : ""}`}
              style={{ background: color }}
              onClick={() => setDraft(color)}
            />
          );
        })}
      </div>
      <ColorArea value={draft} onChange={setDraft} />
    </Modal>
  );
}