import type { LexicalEditor } from "lexical";
import { INSERT_TABLE_COMMAND } from "@lexical/table";

export interface InsertTableOptions {
  rows?: number;
  columns?: number;
  includeHeaders?: boolean;
}

export function insertTable(
  editor: LexicalEditor,
  { rows = 3, columns = 3, includeHeaders = true }: InsertTableOptions = {},
): void {
  editor.dispatchCommand(INSERT_TABLE_COMMAND, {
    rows: String(rows),
    columns: String(columns),
    includeHeaders: { rows: includeHeaders, columns: false },
  });
}
