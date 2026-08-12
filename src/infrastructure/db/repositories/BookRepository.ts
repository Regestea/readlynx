import type Database from "better-sqlite3";
import type { BookEntity, BookListItem } from "../entities/index.ts";
import type { BookKind } from "../../../shared/types/index.ts";

export class BookRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates a new book row with default metadata. */
  insert(bookId: string, title = "Untitled", kind: BookKind = "created"): void {
    this.db
      .prepare("INSERT INTO Books (id, title, kind) VALUES (?, ?, ?)")
      .run(bookId, title, kind);
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

  findById(bookId: string): BookEntity | undefined {
    return this.db.prepare("SELECT * FROM Books WHERE id = ?").get(bookId) as
      | BookEntity
      | undefined;
  }

  /** All books, most recently updated first (shelf order). */
  list(): BookListItem[] {
    return this.db
      .prepare(
        "SELECT id, title, kind, coverImage, createdAt, updatedAt FROM Books ORDER BY updatedAt DESC, createdAt DESC",
      )
      .all() as BookListItem[];
  }
}