import type { ReactNode } from "react";
import styles from "./Table.module.css";

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  headerDir?: "rtl" | "ltr";
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
}

export function Table<T>({ columns, rows }: TableProps<T>) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                dir={column.headerDir}
                className={`${styles.headCell} ${column.align === "right" ? styles.right : ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${styles.cell} ${column.align === "right" ? styles.right : ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
