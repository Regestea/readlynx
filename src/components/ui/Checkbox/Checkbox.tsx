import { useId } from "react";
import { Check } from "lucide-react";
import styles from "./Checkbox.module.css";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  const id = useId();

  return (
    <label className={`${styles.label} ${disabled ? styles.disabled : ""}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`${styles.box} ${checked ? styles.boxChecked : ""}`} aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
      {label && <span className={styles.text}>{label}</span>}
    </label>
  );
}
