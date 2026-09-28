import type { ReactNode } from "react";
import styles from "./Table.module.css";

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  headerDir?: "rtl" | "ltr";
  /** Text direction of each body cell, decided from that cell's own content.
   *  It is applied to the `<td>` itself, not to a wrapper: `text-align` has no
   *  effect on an inline element, so a span can flip the glyph order of an RTL
   *  cell but leaves it aligned to the table's own direction. On the cell, the
   *  `dir` also resolves the `text-align: start` in the stylesheet. */
  cellDir?: (row: T) => "rtl" | "ltr" | undefined;
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
              {columns.map((column) => {
                const dir = column.cellDir?.(row);
                return (
                  <td
                    key={column.key}
                    dir={dir}
                    className={`${styles.cell} ${column.align === "right" ? styles.right : ""}`}
                  >
                    {column.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
