import type Database from "better-sqlite3";
import type { TranslationEntity, TranslationMethod } from "../entities/index.ts";

/** Row store for the `Translations` table (cached AI translations per PDF
 *  page or EPUB chunk). Rows cascade away with their book. */
export class TranslationRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Finds cached translations for a unit of content. There is one result
   *  per page / per chapter regardless of the pipeline (ocr / vision /
   *  chapter) that produced it, so the method is optional: match PDF rows
   *  exactly on `pageNumber`, and every chunk of an EPUB chapter via
   *  `chunkKeyPrefix` (e.g. `"chapter_001.xhtml"`). */
  findByKey(
    bookId: string,
    method?: TranslationMethod | null,
    pageNumber?: number | null,
    chunkKeyPrefix?: string | null,
  ): TranslationEntity[] {
    if (chunkKeyPrefix) {
      const rows = method
        ? this.db
            .prepare(
              `SELECT * FROM Translations
               WHERE bookId = ? AND method = ? AND chunkKey LIKE ?
               ORDER BY chunkKey`,
            )
            .all(bookId, method, `${chunkKeyPrefix}#%`)
        : this.db
            .prepare(
              `SELECT * FROM Translations
               WHERE bookId = ? AND chunkKey LIKE ?
               ORDER BY chunkKey`,
            )
            .all(bookId, `${chunkKeyPrefix}#%`);
      return rows as TranslationEntity[];
    }
    const rows = method
      ? this.db
          .prepare(
            `SELECT * FROM Translations
             WHERE bookId = ? AND method = ? AND pageNumber = ? AND chunkKey IS NULL
             ORDER BY updatedAt DESC`,
          )
          .all(bookId, method, pageNumber ?? null)
      : this.db
          .prepare(
            `SELECT * FROM Translations
             WHERE bookId = ? AND pageNumber = ? AND chunkKey IS NULL
             ORDER BY updatedAt DESC`,
          )
          .all(bookId, pageNumber ?? null);
    return rows as TranslationEntity[];
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

  /** Removes the cached translations of a unit (used when regenerating; the
   *  old rows stay intact until the fresh result succeeds). When `method` is
   *  omitted every pipeline's rows for the unit are removed, keeping the
   *  one-per-page / one-per-chapter invariant. */
  deleteWhere(
    bookId: string,
    method?: TranslationMethod | null,
    pageNumber?: number | null,
    chunkKeyPrefix?: string | null,
  ): void {
    if (chunkKeyPrefix) {
      if (method) {
        this.db
          .prepare(
            "DELETE FROM Translations WHERE bookId = ? AND method = ? AND chunkKey LIKE ?",
          )
          .run(bookId, method, `${chunkKeyPrefix}#%`);
      } else {
        this.db
          .prepare("DELETE FROM Translations WHERE bookId = ? AND chunkKey LIKE ?")
          .run(bookId, `${chunkKeyPrefix}#%`);
      }
    } else if (method) {
      this.db
        .prepare(
          "DELETE FROM Translations WHERE bookId = ? AND method = ? AND pageNumber = ? AND chunkKey IS NULL",
        )
        .run(bookId, method, pageNumber ?? null);
    } else {
      this.db
        .prepare(
          "DELETE FROM Translations WHERE bookId = ? AND pageNumber = ? AND chunkKey IS NULL",
        )
        .run(bookId, pageNumber ?? null);
    }
  }
}