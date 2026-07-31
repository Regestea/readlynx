import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./Input.module.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leading, trailing, className = "", ...rest },
  ref,
) {
  const classes = [
    styles.input,
    leading ? styles.withLeading : "",
    trailing ? styles.withTrailing : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.wrapper}>
      {leading && (
        <span className={styles.leading} aria-hidden="true">
          {leading}
        </span>
      )}
      <input ref={ref} className={classes} {...rest} />
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
});
