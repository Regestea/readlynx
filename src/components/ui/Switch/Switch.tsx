import { useId } from "react";
import styles from "./Switch.module.css";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible text next to the track (the settings cards usually label the row
   *  instead and pass the row text here as the accessible name). */
  label?: string;
  /** Accessible name for the input when the visible label lives outside the
   *  switch (option rows, lists). */
  ariaLabel?: string;
  disabled?: boolean;
}

/** A pill toggle — the same contract as `Checkbox`, a different shape. */
export function Switch({ checked, onChange, label, ariaLabel, disabled = false }: SwitchProps) {
  const id = useId();

  return (
    <label className={`${styles.label} ${disabled ? styles.disabled : ""}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`${styles.track} ${checked ? styles.trackOn : ""}`} aria-hidden="true">
        <span className={styles.knob} />
      </span>
      {label && <span className={styles.text}>{label}</span>}
    </label>
  );
}
