import { useRef } from "react";
import { Check } from "lucide-react";
import styles from "./ColorSelect.module.css";

const PRESET_COLORS = ["#5b6b50", "#737b58", "#8a8c67", "#b9794c", "#8c6248", "#4c382b", "#c18b4d"];

interface ColorSelectProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

export function ColorSelect({ value, onChange, label }: ColorSelectProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const isPreset = PRESET_COLORS.includes(value.toLowerCase());

  return (
    <div className={styles.wrap} role="radiogroup" aria-label={label ?? "Pick a color"}>
      {PRESET_COLORS.map((color) => (
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
        aria-checked={!isPreset}
        aria-label="Pick a custom color"
        className={`${styles.swatch} ${styles.customSwatch} ${!isPreset ? styles.swatchActive : ""}`}
        onClick={() => colorInputRef.current?.click()}
      >
        {!isPreset && (
          <Check size={12} strokeWidth={3.5} className={styles.swatchCheck} aria-hidden="true" />
        )}
      </button>
      <input
        ref={colorInputRef}
        type="color"
        className={styles.colorInput}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Custom color picker"
      />
    </div>
  );
}
