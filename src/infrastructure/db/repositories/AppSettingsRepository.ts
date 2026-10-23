import type Database from "better-sqlite3";
import type { AppSettingsEntity } from "../entities/index.ts";
import { UI_SCALE_DEFAULT } from "../../../shared/uiScale.ts";

/** Partial patch over the single-row `AppSettings` table; missing fields
 *  keep their stored values. The `openWithAdd*` fields are booleans in the
 *  API and 0/1 flags in the database. */
export interface AppSettingsInput {
  theme?: string;
  chatZoom?: number;
  uiScale?: number;
  openWithAddPdf?: boolean;
  openWithAddEpub?: boolean;
  openWithAddMarkdown?: boolean;
}

interface AppSettingsRow {
  theme: string;
  chatZoom: number;
  /** Missing on rows written before the column existed; read() supplies the
   *  default instead of forcing every SELECT to know it. */
  uiScale?: number | null;
  /** 0/1 flags in the database → converted to booleans by {@link read}. */
  openWithAddPdf?: number | null;
  openWithAddEpub?: number | null;
  openWithAddMarkdown?: number | null;
}

/** SQLite `0`/`1` → boolean, treating `NULL` (legacy row) as "on". */
function toFlag(value: number | null | undefined): boolean {
  return value === null || value === undefined ? true : value !== 0;
}

/** Single-row `AppSettings` table (implicit `rowid` 1). */
export class AppSettingsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(): AppSettingsEntity | undefined {
    const row = this.db
      .prepare(
        "SELECT theme, chatZoom, uiScale, openWithAddPdf, openWithAddEpub, openWithAddMarkdown FROM AppSettings LIMIT 1",
      )
      .get() as AppSettingsRow | undefined;
    if (!row) return undefined;
    return {
      theme: row.theme,
      chatZoom: row.chatZoom,
      uiScale: row.uiScale ?? UI_SCALE_DEFAULT,
      openWithAddPdf: toFlag(row.openWithAddPdf),
      openWithAddEpub: toFlag(row.openWithAddEpub),
      openWithAddMarkdown: toFlag(row.openWithAddMarkdown),
    };
  }

  /** Upserts the settings row, touching only the provided fields. */
  update(patch: AppSettingsInput): void {
    this.db
      .prepare(
        `INSERT INTO AppSettings (rowid, theme, chatZoom, uiScale, openWithAddPdf, openWithAddEpub, openWithAddMarkdown)
         VALUES (1, COALESCE(@theme, 'light'), COALESCE(@chatZoom, 100), COALESCE(@uiScale, ${UI_SCALE_DEFAULT}),
                 COALESCE(@openWithAddPdf, 1), COALESCE(@openWithAddEpub, 1), COALESCE(@openWithAddMarkdown, 1))
         ON CONFLICT(rowid) DO UPDATE SET
           theme              = COALESCE(@theme,             AppSettings.theme),
           chatZoom           = COALESCE(@chatZoom,          AppSettings.chatZoom),
           uiScale            = COALESCE(@uiScale,           AppSettings.uiScale),
           openWithAddPdf     = COALESCE(@openWithAddPdf,    AppSettings.openWithAddPdf),
           openWithAddEpub    = COALESCE(@openWithAddEpub,   AppSettings.openWithAddEpub),
           openWithAddMarkdown = COALESCE(@openWithAddMarkdown, AppSettings.openWithAddMarkdown)`,
      )
      .run({
        theme: patch.theme ?? null,
        chatZoom: patch.chatZoom ?? null,
        uiScale: patch.uiScale ?? null,
        openWithAddPdf: patch.openWithAddPdf === undefined ? null : patch.openWithAddPdf ? 1 : 0,
        openWithAddEpub: patch.openWithAddEpub === undefined ? null : patch.openWithAddEpub ? 1 : 0,
        openWithAddMarkdown:
          patch.openWithAddMarkdown === undefined ? null : patch.openWithAddMarkdown ? 1 : 0,
      });
  }
}
