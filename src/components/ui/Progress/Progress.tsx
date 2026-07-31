import { clamp } from "../../../shared/utils";
import styles from "./Progress.module.css";

interface ProgressProps {
  value: number;
  variant?: "linear" | "circular";
  size?: number;
  strokeWidth?: number;
  thickness?: number;
  className?: string;
}

export function Progress({
  value,
  variant = "linear",
  size = 132,
  strokeWidth = 11,
  thickness = 8,
  className = "",
}: ProgressProps) {
  const progress = clamp(value);

  if (variant === "circular") {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - progress);

    return (
      <div
        className={`${styles.circularWrap} ${className}`}
        style={{ width: size, height: size }}
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <svg className={styles.circular} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            className={styles.circularTrack}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
          />
          <circle
            className={styles.circularFill}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`${styles.linear} ${className}`}
      style={{ height: thickness }}
      role="progressbar"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={styles.linearFill} style={{ width: `${progress * 100}%` }} />
    </div>
  );
}
