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
   *  chapter) that produced it, so the method is optional: PDF rows match
   *  exactly on `pageNumber` (their `chunkKey` is `""`), and every chunk of
   *  an EPUB chapter matches via `chunkKeyPrefix` (e.g.
   *  `"chapter_001.xhtml"`). */
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
             WHERE bookId = ? AND method = ? AND pageNumber = ? AND chunkKey = ''
             ORDER BY updatedAt DESC`,
          )
          .all(bookId, method, pageNumber ?? null)
      : this.db
          .prepare(
            `SELECT * FROM Translations
             WHERE bookId = ? AND pageNumber = ? AND chunkKey = ''
             ORDER BY updatedAt DESC`,
          )
          .all(bookId, pageNumber ?? null);
    return rows as TranslationEntity[];
  }

  /**
   * Every translation row of a book, in reading order — what the export
   * dialog loads when it needs the whole book at once.
   *
   * A separate method rather than a `findByKey` mode on purpose: over IPC an
   * omitted filter arrives as `null`, which is indistinguishable from "give me
   * the rows whose page is null" and matches nothing (`= NULL` is never true in
   * SQL). An explicit method keeps the existing lookups untouched.
   */
  findAllForBook(bookId: string): TranslationEntity[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM Translations
         WHERE bookId = ?
         ORDER BY pageNumber, chunkKey`,
      )
      .all(bookId);
    return rows as TranslationEntity[];
  }

  /** Every unit of a book that already has a translation, without reading
   *  the (potentially huge) markdown bodies. `pages` holds the translated
   *  PDF page numbers; `chapters` holds the chapter keys of every EPUB /
   *  Markdown chapter that has at least one cached chunk (`<key>#<index>`
   *  rows are folded back to `<key>`). Powers the Manage translations
   *  dialog's per-page / per-chapter status list. */
  findUnitKeys(bookId: string): { pages: number[]; chapters: string[] } {
    const rows = this.db
      .prepare("SELECT pageNumber, chunkKey FROM Translations WHERE bookId = ?")
      .all(bookId) as Array<{ pageNumber: number | null; chunkKey: string | null }>;
    const pages: number[] = [];
    const chapters = new Set<string>();
    for (const row of rows) {
      if (row.chunkKey) {
        // Chunk rows are `<chapterKey>#<zero-padded index>`; a chapter key
        // may itself contain '#', so only the last one is the separator.
        const at = row.chunkKey.lastIndexOf("#");
        chapters.add(at > 0 ? row.chunkKey.slice(0, at) : row.chunkKey);
        continue;
      }
      if (typeof row.pageNumber === "number" && Number.isFinite(row.pageNumber)) {
        pages.push(row.pageNumber);
      }
    }
    return { pages, chapters: [...chapters] };
  }

  /** Inserts or replaces the cached translation for its unit of content
   *  (unique on `bookId + pageNumber + chunkKey`, so switching the OCR /
   *  AI-vision pipeline overwrites the page's only row). */
  upsert(entity: TranslationEntity): void {
    this.db
      .prepare(
        `INSERT INTO Translations (
           id, bookId, sourceType, method, pageNumber, chunkKey,
           sourceLang, targetLang, customPrompt, markdown, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(bookId, pageNumber, chunkKey) DO UPDATE SET
           sourceType   = excluded.sourceType,
           method       = excluded.method,
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
          "DELETE FROM Translations WHERE bookId = ? AND method = ? AND pageNumber = ? AND chunkKey = ''",
        )
        .run(bookId, method, pageNumber ?? null);
    } else {
      this.db
        .prepare(
          "DELETE FROM Translations WHERE bookId = ? AND pageNumber = ? AND chunkKey = ''",
        )
        .run(bookId, pageNumber ?? null);
    }
  }
}