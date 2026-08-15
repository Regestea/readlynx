import type Database from "better-sqlite3";
import type { AppSettingsEntity } from "../entities/index.ts";

/** Partial patch over the single-row `AppSettings` table; missing fields
 *  keep their stored values. */
export interface AppSettingsInput {
  theme?: string;
  chatZoom?: number;
}

/** Single-row `AppSettings` table (implicit `rowid` 1). */
export class AppSettingsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(): AppSettingsEntity | undefined {
    return this.db.prepare("SELECT theme, chatZoom FROM AppSettings LIMIT 1").get() as
      | AppSettingsEntity
      | undefined;
  }

  /** Upserts the settings row, touching only the provided fields. */
  update(patch: AppSettingsInput): void {
    this.db
      .prepare(
        `INSERT INTO AppSettings (rowid, theme, chatZoom)
         VALUES (1, COALESCE(@theme, 'light'), COALESCE(@chatZoom, 100))
         ON CONFLICT(rowid) DO UPDATE SET
           theme    = COALESCE(@theme,    AppSettings.theme),
           chatZoom = COALESCE(@chatZoom, AppSettings.chatZoom)`,
      )
      .run({
        theme: patch.theme ?? null,
        chatZoom: patch.chatZoom ?? null,
      });
  }
}