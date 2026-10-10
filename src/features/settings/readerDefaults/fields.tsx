import { Check, Minus, Plus } from "lucide-react";
import { READING_BACKGROUNDS } from "../../../components/ui/ColorPickerPanel/colors";
import { ColorSelect } from "../../../components/ui/ColorSelect/ColorSelect";
import styles from "./readerDefaults.module.css";

const ZOOM_MIN = 60;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

/** Zoom stepper mirroring the reader toolbars (click the value to reset). The
 *  bounds are per-viewer because the ranges genuinely differ: the text
 *  readers zoom body text between 60 and 200%, while the PDF viewer scales
 *  the page itself and goes from half to three times the fitted size. */
export function ZoomField({
  value,
  onChange,
  min = ZOOM_MIN,
  max = ZOOM_MAX,
  step = ZOOM_STEP,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className={styles.zoomRow}>
      <button
        type="button"
        className={styles.zoomButton}
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label="Decrease default zoom"
        title="Decrease default zoom"
      >
        <Minus size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.zoomValue}
        onClick={() => onChange(100)}
        aria-label={`Default zoom ${value} percent, click to reset`}
        title="Reset default zoom to 100%"
      >
        {value}%
      </button>
      <button
        type="button"
        className={styles.zoomButton}
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label="Increase default zoom"
        title="Increase default zoom"
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Inline color picker: curated reading swatches + the full custom picker
 *  (saturation/value square, hue bar, hex field) + a "follow theme" reset.
 *  `null` means "follow the app theme" (no override). */
export function DefaultColorField({
  label,
  hint,
  value,
  onChange,
  themeLabel = "Follow theme",
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  themeLabel?: string;
}) {
  const active = (value ?? "").toLowerCase();

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {hint && <span className={styles.fieldHint}>{hint}</span>}
      <div className={styles.swatches} role="radiogroup" aria-label={label}>
        {READING_BACKGROUNDS.map(({ name, color }) => {
          const selected = active === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={name ?? color}
              title={name ?? color}
              className={`${styles.swatch} ${selected ? styles.swatchActive : ""}`}
              style={{ background: color }}
              onClick={() => onChange(color)}
            >
              {selected && (
                <Check size={12} strokeWidth={3.5} className={styles.swatchCheck} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
      {/* The curated grid above is the palette; below it the custom swatch
          unfolds the full picker (square, hue bar, hex field) for everything
          the curated colors miss. */}
      <ColorSelect
        value={value ?? ""}
        onChange={(color) => onChange(color || null)}
        presets={[]}
        label={label}
      />
      <span className={styles.currentValue}>
        {value ?? themeLabel}
        {value !== null && (
          <>
            {" · "}
            <button type="button" className={styles.themeButton} onClick={() => onChange(null)}>
              {themeLabel}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

