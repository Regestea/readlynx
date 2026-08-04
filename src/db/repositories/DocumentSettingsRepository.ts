import type Database from "better-sqlite3";
import type { DocumentSettingsEntity } from "../entities/index.ts";

export type DocumentSettingsInput = Omit<DocumentSettingsEntity, "documentId" | "updatedAt">;

export class DocumentSettingsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates settings with defaults for a new document. */
  insert(documentId: string): void {
    this.db.prepare("INSERT INTO DocumentSettings (documentId) VALUES (?)").run(documentId);
  }

  /** Inserts or fully replaces the settings row, bumping `updatedAt`. */
  upsert(documentId: string, settings: DocumentSettingsInput): void {
    this.db
      .prepare(
        `INSERT INTO DocumentSettings (
           documentId, layout, pageFormat,
           marginTop, marginRight, marginBottom, marginLeft,
           zoomIndex, fontFamily, fontSize, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(documentId) DO UPDATE SET
           layout       = excluded.layout,
           pageFormat   = excluded.pageFormat,
           marginTop    = excluded.marginTop,
           marginRight  = excluded.marginRight,
           marginBottom = excluded.marginBottom,
           marginLeft   = excluded.marginLeft,
           zoomIndex    = excluded.zoomIndex,
           fontFamily   = excluded.fontFamily,
           fontSize     = excluded.fontSize,
           updatedAt    = excluded.updatedAt`,
      )
      .run(
        documentId,
        settings.layout,
        settings.pageFormat,
        settings.marginTop,
        settings.marginRight,
        settings.marginBottom,
        settings.marginLeft,
        settings.zoomIndex,
        settings.fontFamily,
        settings.fontSize,
      );
  }

  findByDocumentId(documentId: string): DocumentSettingsEntity | undefined {
    return this.db.prepare("SELECT * FROM DocumentSettings WHERE documentId = ?").get(documentId) as
      | DocumentSettingsEntity
      | undefined;
  }
}
