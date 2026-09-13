import { useRef } from "react";
import { Check, Plus } from "lucide-react";
import styles from "./ColorSelect.module.css";

const PRESET_COLORS = ["#5b6b50", "#737b58", "#8a8c67", "#b9794c", "#8c6248", "#4c382b", "#c18b4d"];

interface ColorSelectProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  /** Optional palette to replace the default preset swatches. */
  presets?: string[];
}

export function ColorSelect({ value, onChange, label, presets }: ColorSelectProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const swatches = presets ?? PRESET_COLORS;
  const isPreset = swatches.includes(value.toLowerCase());
  // An empty value means "no color" (e.g. the editor's Default/None); it is
  // neither a preset nor a custom pick, and the color input needs a valid
  // hex fallback.
  const customActive = value !== "" && !isPreset;

  return (
    <div className={styles.wrap} role="radiogroup" aria-label={label ?? "Pick a color"}>
      {swatches.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === color}
          aria-label={`Color ${color}`}
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
        aria-label="Pick a custom color"
        title="Pick a custom color…"
        className={`${styles.swatch} ${styles.customSwatch} ${customActive ? styles.swatchActive : ""}`}
        onClick={() => colorInputRef.current?.click()}
      >
        {customActive ? (
          <Check size={12} strokeWidth={3.5} className={styles.swatchCheck} aria-hidden="true" />
        ) : (
          <Plus size={14} strokeWidth={3} className={styles.swatchCheck} aria-hidden="true" />
        )}
      </button>
      <input
        ref={colorInputRef}
        type="color"
        className={styles.colorInput}
        value={value === "" ? "#000000" : value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Custom color picker"
      />
    </div>
  );
}
