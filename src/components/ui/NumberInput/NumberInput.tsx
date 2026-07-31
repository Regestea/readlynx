import { ChevronDown, ChevronUp } from "lucide-react";
import { clamp } from "../../../shared/utils";
import styles from "./NumberInput.module.css";

interface NumberInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export function NumberInput({ id, value, onChange, min = 0, max = 999, step = 1, label }: NumberInputProps) {
  const bound = (next: number) => clamp(next, min, max);

  return (
    <div className={styles.wrapper}>
      <input
        id={id}
        type="number"
        className={styles.input}
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(bound(Number(event.target.value) || 0))}
      />
      <div className={styles.steppers}>
        <button
          type="button"
          className={styles.step}
          onClick={() => onChange(bound(value + step))}
          aria-label="Increase value"
          tabIndex={-1}
        >
          <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.step}
          onClick={() => onChange(bound(value - step))}
          aria-label="Decrease value"
          tabIndex={-1}
        >
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
