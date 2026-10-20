import type Database from "better-sqlite3";
import type { BookSourceEntity } from "../entities/index.ts";
import type { BookSourceLookupResult } from "../entities/types.ts";

export class BookSourceRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Records the imported PDF/EPUB file behind a book. `filePath` is the
   *  absolute path of the copy stored in the books directory. */
  insert(
    sourceId: string,
    bookId: string,
    sourceType: string,
    filePath: string,
    identity?: { fileHash?: string | null; fileSize?: number | null; originalPath?: string | null },
  ): void {
    this.db
      .prepare(
        "INSERT INTO BookSources (id, bookId, sourceType, filePath, fileHash, fileSize, originalPath) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        sourceId,
        bookId,
        sourceType,
        filePath,
        identity?.fileHash ?? null,
        identity?.fileSize ?? null,
        identity?.originalPath ?? null,
      );
  }

  findByBookId(bookId: string): BookSourceEntity | undefined {
    return this.db.prepare("SELECT * FROM BookSources WHERE bookId = ?").get(bookId) as
      | BookSourceEntity
      | undefined;
  }

  /** Finds the book holding exactly this content (same sha256 + size).
   *  Rows without an identity (`fileHash IS NULL`) never match. The owner's
   *  `temporary` flag rides along: a kept duplicate of a session-only copy
   *  has to be promoted on the same open. */
  findByHash(fileHash: string, fileSize: number): BookSourceLookupResult | undefined {
    return this.db
      .prepare(
        `SELECT s.*, COALESCE(b.temporary, 0) AS temporary
         FROM BookSources s
         LEFT JOIN Books b ON b.id = s.bookId
         WHERE s.fileHash = ? AND s.fileSize = ?
         LIMIT 1`,
      )
      .get(fileHash, fileSize) as BookSourceLookupResult | undefined;
  }

  /** Finds the book originally picked from this OS path (used to detect an
   *  edited file whose content changed but whose location did not). */
  findByOriginalPath(originalPath: string): BookSourceLookupResult | undefined {
    return this.db
      .prepare(
        `SELECT s.*, COALESCE(b.temporary, 0) AS temporary
         FROM BookSources s
         LEFT JOIN Books b ON b.id = s.bookId
         WHERE s.originalPath = ?
         LIMIT 1`,
      )
      .get(originalPath) as BookSourceLookupResult | undefined;
  }

  /** Points the book at a replacement copy (same book, new content): swaps
   *  the stored path and refreshes the content identity. */
  updateIdentity(
    bookId: string,
    fields: { filePath: string; fileHash: string | null; fileSize: number | null; originalPath: string | null },
  ): void {
    this.db
      .prepare(
        "UPDATE BookSources SET filePath = ?, fileHash = ?, fileSize = ?, originalPath = ? WHERE bookId = ?",
      )
      .run(fields.filePath, fields.fileHash, fields.fileSize, fields.originalPath, bookId);
  }

  /** Remembers a new pick location without touching anything else (e.g. the
   *  same content opened from a renamed copy). */
  updateOriginalPath(bookId: string, originalPath: string): void {
    this.db
      .prepare("UPDATE BookSources SET originalPath = ? WHERE bookId = ?")
      .run(originalPath, bookId);
  }
}
