import type Database from "better-sqlite3";
import type { BookEntity, BookListItem } from "../entities/index.ts";

export class BookRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates a new book row with default metadata. */
  insert(bookId: string, title = "Untitled"): void {
    this.db.prepare("INSERT INTO Books (id, title) VALUES (?, ?)").run(bookId, title);
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

  findById(bookId: string): BookEntity | undefined {
    return this.db.prepare("SELECT * FROM Books WHERE id = ?").get(bookId) as
      | BookEntity
      | undefined;
  }

  /** All books, most recently updated first (shelf order). */
  list(): BookListItem[] {
    return this.db
      .prepare(
        "SELECT id, title, coverImage, createdAt, updatedAt FROM Books ORDER BY updatedAt DESC, createdAt DESC",
      )
      .all() as BookListItem[];
  }
}
