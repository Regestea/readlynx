import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  /** Plain options (used when `groups` is not provided). */
  options?: SelectOption[];
  /** Grouped options rendered as `<optgroup>` sections. */
  groups?: SelectGroup[];
  /** Smaller sizing for compact toolbars / dropdowns. */
  compact?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options = [], groups, className = "", compact = false, ...rest },
  ref,
) {
  return (
    <div className={styles.wrapper}>
      <select
        ref={ref}
        className={`${styles.select} ${compact ? styles.selectCompact : ""} ${className}`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown size={18} strokeWidth={1.8} className={styles.chevron} aria-hidden="true" />
    </div>
  );
});