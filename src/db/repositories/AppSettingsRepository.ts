import type Database from "better-sqlite3";
import type { AppSettingsEntity } from "../entities/index.ts";

/** Single-row `AppSettings` table (implicit `rowid` 1). */
export class AppSettingsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(): AppSettingsEntity | undefined {
    return this.db.prepare("SELECT theme FROM AppSettings LIMIT 1").get() as
      | AppSettingsEntity
      | undefined;
  }

  /** Upserts the settings row, keeping the theme in sync. */
  updateTheme(theme: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO AppSettings (rowid, theme) VALUES (1, ?)")
      .run(theme);
  }
}
