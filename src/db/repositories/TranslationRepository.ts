import type Database from "better-sqlite3";
import type { TranslationEntity, TranslationMethod } from "../entities/index.ts";

/** Row store for the `Translations` table (cached AI translations per PDF
 *  page or EPUB chunk). Rows cascade away with their book. */
export class TranslationRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Finds cached translations for a unit of content. PDF translations match
   *  exactly on `pageNumber`; EPUB translations match every chunk of a
   *  chapter via `chunkKeyPrefix` (e.g. `"chapter_001.xhtml"`). */
  findByKey(
    bookId: string,
    method: TranslationMethod,
    pageNumber?: number | null,
    chunkKeyPrefix?: string | null,
  ): TranslationEntity[] {
    if (chunkKeyPrefix) {
      return this.db
        .prepare(
          `SELECT * FROM Translations
           WHERE bookId = ? AND method = ? AND chunkKey LIKE ?
           ORDER BY chunkKey`,
        )
        .all(bookId, method, `${chunkKeyPrefix}#%`) as TranslationEntity[];
    }
    return this.db
      .prepare(
        `SELECT * FROM Translations
         WHERE bookId = ? AND method = ? AND pageNumber = ? AND chunkKey IS NULL`,
      )
      .all(bookId, method, pageNumber ?? null) as TranslationEntity[];
  }

  /** Inserts or replaces the cached translation for its unit of content
   *  (unique on `bookId + method + pageNumber` for PDF and
   *  `bookId + method + chunkKey` for EPUB). */
  upsert(entity: TranslationEntity): void {
    this.db
      .prepare(
        `INSERT INTO Translations (
           id, bookId, sourceType, method, pageNumber, chunkKey,
           sourceLang, targetLang, customPrompt, markdown, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(bookId, method, pageNumber, chunkKey) DO UPDATE SET
           sourceType   = excluded.sourceType,
           sourceLang   = excluded.sourceLang,
           targetLang   = excluded.targetLang,
           customPrompt = excluded.customPrompt,
           markdown     = excluded.markdown,
           updatedAt    = excluded.updatedAt`,
      )
      .run(
        entity.id,
        entity.bookId,
        entity.sourceType,
        entity.method,
        entity.pageNumber,
        entity.chunkKey,
        entity.sourceLang,
        entity.targetLang,
        entity.customPrompt,
        entity.markdown,
      );
  }

  /** Removes cached translations (used when regenerating; the old rows stay
   *  intact until the fresh result succeeds). */
  deleteWhere(
    bookId: string,
    method: TranslationMethod,
    pageNumber?: number | null,
    chunkKeyPrefix?: string | null,
  ): void {
    if (chunkKeyPrefix) {
      this.db
        .prepare("DELETE FROM Translations WHERE bookId = ? AND method = ? AND chunkKey LIKE ?")
        .run(bookId, method, `${chunkKeyPrefix}#%`);
    } else {
      this.db
        .prepare(
          "DELETE FROM Translations WHERE bookId = ? AND method = ? AND pageNumber = ? AND chunkKey IS NULL",
        )
        .run(bookId, method, pageNumber ?? null);
    }
  }
}