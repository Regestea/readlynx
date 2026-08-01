import type { ReactNode } from "react";
import styles from "./List.module.css";

export interface ListItemData {
  id: string;
  icon?: ReactNode;
  label: string;
  description?: string;
  trailing?: ReactNode;
  dir?: "rtl" | "ltr";
}

interface ListProps {
  items: ListItemData[];
}

export function List({ items }: ListProps) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          {item.icon && (
            <span className={styles.icon} aria-hidden="true">
              {item.icon}
            </span>
          )}
          <div className={styles.body}>
            <span className={styles.label} dir={item.dir}>
              {item.label}
            </span>
            {item.description && <span className={styles.description}>{item.description}</span>}
          </div>
          {item.trailing && <span className={styles.trailing}>{item.trailing}</span>}
        </li>
      ))}
    </ul>
  );
}
