import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import styles from "./TextArea.module.css";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className = "", ...rest },
  ref,
) {
  return <textarea ref={ref} className={`${styles.textarea} ${className}`} {...rest} />;
});
