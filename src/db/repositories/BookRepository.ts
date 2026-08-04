import type Database from "better-sqlite3";
import type { BookEntity, BookListItem } from "../entities/index.ts";
import type { BookWithDecodedCover } from "../entities/types.ts";

export class BookRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates a new book row with default metadata. */
  insert(bookId: string, title = "Untitled"): void {
    this.db.prepare("INSERT INTO Books (id, title) VALUES (?, ?)").run(bookId, title);
  }

  /** Updates book metadata and bumps `updatedAt`. */
  update(bookId: string, fields: { title: string; coverImage: string | null }): void {
    this.db
      .prepare(
        "UPDATE Books SET title = ?, coverImage = ?, updatedAt = datetime('now') WHERE id = ?",
      )
      .run(fields.title, this.toCoverBlob(fields.coverImage), bookId);
  }

  findById(bookId: string): BookEntity | undefined {
    return this.db.prepare("SELECT * FROM Books WHERE id = ?").get(bookId) as
      | BookEntity
      | undefined;
  }

  /** Like `findById`, with the cover BLOB decoded back to a data URL. */
  findByIdWithCover(bookId: string): BookWithDecodedCover | undefined {
    const row = this.findById(bookId);
    if (!row) return undefined;
    return {
      ...row,
      coverImage: this.fromCoverBlob(row.coverImage as Buffer | null),
    };
  }

  /** All books, most recently updated first (shelf order). */
  list(): BookListItem[] {
    const rows = this.db
      .prepare(
        "SELECT id, title, coverImage, createdAt, updatedAt FROM Books ORDER BY updatedAt DESC, createdAt DESC",
      )
      .all() as Array<{ coverImage: Buffer | null } & Omit<BookListItem, "coverImage">>;
    return rows.map((row) => ({
      ...row,
      coverImage: this.fromCoverBlob(row.coverImage),
    }));
  }

  private toCoverBlob(coverImage: string | null): Buffer | null {
    if (!coverImage) return null;
    return Buffer.from(coverImage, "utf8");
  }

  private fromCoverBlob(coverImage: Buffer | null): string | null {
    if (!coverImage) return null;
    const value = coverImage.toString("utf8");
    return value.startsWith("data:") ? value : null;
  }
}
