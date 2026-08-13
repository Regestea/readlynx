import type Database from "better-sqlite3";
import type { ReaderSettingsEntity, ReaderViewer } from "../entities/index.ts";

/** Partial reader-settings update: only the provided columns are written, so
 *  each viewer can save just its own fields without clobbering the others. */
export interface ReaderSettingsInput {
  zoomPct?: number;
  fontFamily?: string;
  /** Custom background color override (null = follow the app theme). */
  customBg?: string | null;
  /** Custom text color override (null = follow the app theme). */
  customText?: string | null;
  /** PDF viewer background (null = app default paper). */
  pdfBackground?: string | null;
}

/** Row store for the `ReaderSettings` table (one per book + viewer). */
export class ReaderSettingsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findByKey(bookId: string, viewer: ReaderViewer): ReaderSettingsEntity | undefined {
    return this.db
      .prepare("SELECT * FROM ReaderSettings WHERE bookId = ? AND viewer = ?")
      .get(bookId, viewer) as ReaderSettingsEntity | undefined;
  }

  /** Inserts a row (with defaults) or updates the provided columns, bumping
   *  `updatedAt`. Numeric/text fields keep their stored value when omitted;
   *  the clearable color overrides are always written as given (null resets
   *  them). */
  upsert(bookId: string, viewer: ReaderViewer, settings: ReaderSettingsInput): void {
    this.db
      .prepare(
        `INSERT INTO ReaderSettings (
           bookId, viewer, zoomPct, fontFamily, customBg, customText,
           pdfBackground, updatedAt
         ) VALUES (
           @bookId, @viewer,
           COALESCE(@zoomPct, 100),
           COALESCE(@fontFamily, ''),
           @customBg, @customText, @pdfBackground,
           datetime('now')
         )
         ON CONFLICT(bookId, viewer) DO UPDATE SET
           zoomPct       = COALESCE(@zoomPct,       ReaderSettings.zoomPct),
           fontFamily    = COALESCE(@fontFamily,    ReaderSettings.fontFamily),
           customBg      = @customBg,
           customText    = @customText,
           pdfBackground = @pdfBackground,
           updatedAt     = datetime('now')`,
      )
      .run({
        bookId,
        viewer,
        zoomPct: settings.zoomPct ?? null,
        fontFamily: settings.fontFamily ?? null,
        customBg: settings.customBg ?? null,
        customText: settings.customText ?? null,
        pdfBackground: settings.pdfBackground ?? null,
      });
  }
}