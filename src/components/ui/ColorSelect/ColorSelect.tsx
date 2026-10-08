import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { ColorPickerModal } from "../ColorPickerPanel/ColorPickerModal";
import styles from "./ColorSelect.module.css";

const PRESET_COLORS = ["#5b6b50", "#737b58", "#8a8c67", "#b9794c", "#8c6248", "#4c382b", "#c18b4d"];

interface ColorSelectProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  /** Optional palette to replace the default preset swatches. */
  presets?: string[];
  /** Extra curated swatches handed to the dialog on top of the reading
   *  backgrounds it always offers (usually the same set as `presets`). */
  dialogPresets?: string[];
}

/**
 * The swatch row every color section ends with: the curated presets first,
 * then a custom swatch that opens the shared color dialog. One click for a
 * curated color, the full picker (square, hue bar, hex) only for what the
 * presets miss — and nothing is written to the setting until Apply.
 */
export function ColorSelect({
  value,
  onChange,
  label,
  presets,
  dialogPresets,
}: ColorSelectProps) {
  const swatches = presets ?? PRESET_COLORS;
  const isPreset = swatches.some((color) => color.toLowerCase() === value.toLowerCase());
  // An empty value means "no color" (e.g. the editor's Default/None); it is
  // neither a preset nor a custom pick.
  const customActive = value !== "" && !isPreset;
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <div className={styles.row} role="radiogroup" aria-label={label ?? "Pick a color"}>
        {swatches.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === color}
            aria-label={`Color ${color}`}
            title={color}
            className={`${styles.swatch} ${value.toLowerCase() === color ? styles.swatchActive : ""}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
          >
            {value.toLowerCase() === color && (
              <Check size={12} strokeWidth={3.5} className={styles.swatchCheck} aria-hidden="true" />
            )}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={customActive}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          aria-label="Pick a custom color"
          title="Pick a custom color…"
          className={`${styles.swatch} ${styles.customSwatch} ${customActive ? styles.swatchActive : ""}`}
          onClick={() => setDialogOpen(true)}
        >
          {customActive ? (
            <Check size={12} strokeWidth={3.5} className={styles.swatchCheck} aria-hidden="true" />
          ) : (
            <Plus size={14} strokeWidth={3} className={styles.swatchCheck} aria-hidden="true" />
          )}
        </button>
      </div>
      {dialogOpen && (
        <ColorPickerModal
          title={label ? `Pick ${label.toLowerCase()}` : "Pick a color"}
          value={value}
          presets={dialogPresets ?? swatches}
          onApply={(color) => {
            onChange(color);
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}