import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import styles from "./AddModeCard.module.css";

interface AddModeCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
}

export function AddModeCard({ icon, title, description, onClick }: AddModeCardProps) {
  return (
    <button
      type="button"
      className={`animate-card-appear ${styles.card}`}
      aria-label={`Add — ${title}`}
      onClick={onClick}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        <span className={styles.description}>{description}</span>
      </span>
      <span className={styles.plus} aria-hidden="true">
        <Plus size={18} strokeWidth={1.8} />
      </span>
    </button>
  );
}
