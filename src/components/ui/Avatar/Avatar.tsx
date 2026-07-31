import { getInitials } from "../../../shared/utils";
import styles from "./Avatar.module.css";

interface AvatarProps {
  name: string;
  size?: number;
  className?: string;
}

export function Avatar({ name, size = 40, className = "" }: AvatarProps) {
  return (
    <span
      className={`${styles.avatar} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      role="img"
      aria-label={`Avatar of ${name}`}
    >
      {getInitials(name)}
    </span>
  );
}
