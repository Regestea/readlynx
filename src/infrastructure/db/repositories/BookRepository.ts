import type Database from "better-sqlite3";
import type { BookEntity, BookListItem } from "../entities/index.ts";
import type { BookKind } from "../../../shared/types/index.ts";

export class BookRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates a new book row with default metadata. `temporary` marks a
   *  session-only import (its file type's add-to-library switch is off):
   *  hidden from the shelf and purged at the next launch. */
  insert(
    bookId: string,
    title = "Untitled",
    kind: BookKind = "created",
    temporary = false,
  ): void {
    this.db
      .prepare("INSERT INTO Books (id, title, kind, temporary) VALUES (?, ?, ?, ?)")
      .run(bookId, title, kind, temporary ? 1 : 0);
  }

  /** Updates book metadata and bumps `updatedAt`. `coverImage` is a relative
   *  path like `covers/<file>`; files themselves are managed by the worker. */
  update(bookId: string, fields: { title: string; coverImage: string | null }): void {
    this.db
      .prepare(
        "UPDATE Books SET title = ?, coverImage = ?, updatedAt = datetime('now') WHERE id = ?",
      )
      .run(fields.title, fields.coverImage, bookId);
  }

  /** Deletes a book row. Related rows (document, settings, sources, reading
   *  state) are removed by their `ON DELETE CASCADE` constraints. */
  remove(bookId: string): void {
    this.db.prepare("DELETE FROM Books WHERE id = ?").run(bookId);
  }

  /** Flips a book between a permanent library entry and a session-only copy
   *  (the open dialog's keep choice applies to "Open with" duplicates).
   *  Returns false when the book does not exist. */
  setTemporary(bookId: string, temporary: boolean): boolean {
    const result = this.db
      .prepare("UPDATE Books SET temporary = ? WHERE id = ?")
      .run(temporary ? 1 : 0, bookId);
    return result.changes > 0;
  }

  findById(bookId: string): BookEntity | undefined {
    return this.db.prepare("SELECT * FROM Books WHERE id = ?").get(bookId) as
      | BookEntity
      | undefined;
  }

  /** Pins or unpins a book. Pinning stamps `pinnedAt` (newest pins first
   *  on the Pinned shelf); unpinning clears it. Returns false when the book
   *  does not exist. */
  setPinned(bookId: string, pinned: boolean): boolean {
    const book = this.findById(bookId);
    if (!book) return false;
    if (pinned) {
      this.db
        .prepare("UPDATE Books SET isPinned = 1, pinnedAt = datetime('now') WHERE id = ?")
        .run(bookId);
    } else {
      this.db
        .prepare("UPDATE Books SET isPinned = 0, pinnedAt = NULL WHERE id = ?")
        .run(bookId);
    }
    return true;
  }

  /** All books, most recently active first (shelf order). Reading books have
   *  no edit flow to bump `updatedAt`, so they sort by their last opened time
   *  instead (falling back to `updatedAt` if never opened). Pinned books
   *  sort first by their pin time so the Pinned shelf stays stable. Session
   *  imports (`temporary`) never appear on the shelf. */
  list(): BookListItem[] {
    return this.db
      .prepare(
        `SELECT b.id, b.title, b.kind, b.coverImage, b.createdAt, b.updatedAt,
                COALESCE(b.isPinned, 0) AS isPinned, b.pinnedAt
         FROM Books b
         LEFT JOIN ReadingState rs ON rs.bookId = b.id
         WHERE COALESCE(b.temporary, 0) = 0
         ORDER BY
           COALESCE(b.isPinned, 0) DESC,
           b.pinnedAt DESC,
           CASE WHEN b.kind = 'reading'
             THEN COALESCE(rs.lastOpenedAt, b.updatedAt)
             ELSE b.updatedAt
           END DESC,
           b.createdAt DESC`,
      )
      .all() as BookListItem[];
  }
}