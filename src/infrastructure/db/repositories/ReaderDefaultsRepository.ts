import type Database from "better-sqlite3";
import type { ReaderDefaultsEntity, ReaderViewer } from "../entities/index.ts";
import type { ReaderSettingsInput } from "./ReaderSettingsRepository.ts";

/** Row store for the `ReaderDefaults` table (one per viewer). Holds the
 *  global reader defaults edited in Settings; books without a per-book
 *  `ReaderSettings` row fall back to these values. */
export class ReaderDefaultsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findByViewer(viewer: ReaderViewer): ReaderDefaultsEntity | undefined {
    return this.db
      .prepare("SELECT * FROM ReaderDefaults WHERE viewer = ?")
      .get(viewer) as ReaderDefaultsEntity | undefined;
  }

  list(): ReaderDefaultsEntity[] {
    return this.db.prepare("SELECT * FROM ReaderDefaults").all() as ReaderDefaultsEntity[];
  }

  /** Inserts the viewer's row (with defaults) or updates the provided
   *  columns, bumping `updatedAt`. Semantics mirror `ReaderSettingsRepository`
   *  so both stores stay interchangeable for callers. */
  upsert(viewer: ReaderViewer, settings: ReaderSettingsInput): void {
    this.db
      .prepare(
        `INSERT INTO ReaderDefaults (
           viewer, zoomPct, fontFamily, customBg, customText,
           textHardOverride, pdfBackground,
           codeTheme, diagramTheme, codeBackground, diagramBackground,
           updatedAt
         ) VALUES (
           @viewer,
           COALESCE(@zoomPct, 100),
           COALESCE(@fontFamily, ''),
           @customBg, @customText,
           COALESCE(@textHardOverride, 0),
           @pdfBackground,
           @codeTheme, @diagramTheme, @codeBackground, @diagramBackground,
           datetime('now')
         )
         ON CONFLICT(viewer) DO UPDATE SET
           zoomPct           = COALESCE(@zoomPct,          ReaderDefaults.zoomPct),
           fontFamily        = COALESCE(@fontFamily,       ReaderDefaults.fontFamily),
           customBg          = @customBg,
           customText        = @customText,
           textHardOverride  = COALESCE(@textHardOverride, ReaderDefaults.textHardOverride, 0),
           pdfBackground     = @pdfBackground,
           codeTheme         = @codeTheme,
           diagramTheme      = @diagramTheme,
           codeBackground    = @codeBackground,
           diagramBackground = @diagramBackground,
           updatedAt         = datetime('now')`,
      )
      .run({
        viewer,
        zoomPct: settings.zoomPct ?? null,
        fontFamily: settings.fontFamily ?? null,
        customBg: settings.customBg ?? null,
        customText: settings.customText ?? null,
        textHardOverride:
          settings.textHardOverride == null
            ? null
            : typeof settings.textHardOverride === "boolean"
              ? (settings.textHardOverride ? 1 : 0)
              : settings.textHardOverride,
        pdfBackground: settings.pdfBackground ?? null,
        codeTheme: settings.codeTheme ?? null,
        diagramTheme: settings.diagramTheme ?? null,
        codeBackground: settings.codeBackground ?? null,
        diagramBackground: settings.diagramBackground ?? null,
      });
  }
}
