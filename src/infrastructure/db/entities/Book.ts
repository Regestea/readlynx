import type { BookKind } from "../../../shared/types/index.ts";

/** Row of the `Books` table. `coverImage` is a relative path like
 *  `covers/<file>` (files live next to the database file). `kind` tells the
 *  renderer how to open the book: in the editor (`created` / `translated`)
 *  or in the read-only viewer (`reading`). */
export interface BookEntity {
  id: string;
  title: string;
  coverImage: string | null;
  kind: BookKind;
  createdAt: string;
  updatedAt: string;
  /** 1 = pinned to the top Pinned shelf, 0 = regular shelf order. */
  isPinned: number;
  /** UTC timestamp of the last pin action (NULL when never pinned / unpinned). */
  pinnedAt: string | null;
}