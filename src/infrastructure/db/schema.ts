import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Books (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  coverImage TEXT,
  kind       TEXT NOT NULL DEFAULT 'created',
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Documents (
  id          TEXT PRIMARY KEY,
  bookId      TEXT NOT NULL UNIQUE REFERENCES Books(id) ON DELETE CASCADE,
  contentJson TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS DocumentSettings (
  documentId   TEXT PRIMARY KEY REFERENCES Documents(id) ON DELETE CASCADE,
  layout       TEXT NOT NULL DEFAULT 'paged',
  pageFormat   TEXT NOT NULL DEFAULT 'a4',
  marginTop    REAL NOT NULL DEFAULT 12.7,
  marginRight  REAL NOT NULL DEFAULT 12.7,
  marginBottom REAL NOT NULL DEFAULT 12.7,
  marginLeft   REAL NOT NULL DEFAULT 12.7,
  zoomIndex    INTEGER NOT NULL DEFAULT 2,
  fontFamily   TEXT NOT NULL DEFAULT '',
  fontSize     REAL NOT NULL DEFAULT 14,
  updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS BookSources (
  id         TEXT PRIMARY KEY,
  bookId     TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  sourceType TEXT NOT NULL,
  filePath   TEXT NOT NULL,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ReadingState (
  bookId         TEXT PRIMARY KEY REFERENCES Books(id) ON DELETE CASCADE,
  currentPage    INTEGER NOT NULL DEFAULT 1,
  currentChapter TEXT NOT NULL DEFAULT '',
  ocrLangs       TEXT NOT NULL DEFAULT '["eng"]',
  sourceLang     TEXT NOT NULL DEFAULT '',
  targetLang     TEXT NOT NULL DEFAULT 'English',
  modelId        TEXT NOT NULL DEFAULT '',
  customPromptId TEXT NOT NULL DEFAULT '',
  pdfMethod      TEXT NOT NULL DEFAULT 'ocr',
  modelIds       TEXT NOT NULL DEFAULT '[]',
  totalPages     INTEGER NOT NULL DEFAULT 0,
  totalChapters  INTEGER NOT NULL DEFAULT 0,
  progressPercent REAL NOT NULL DEFAULT 0,
  readingSeconds INTEGER NOT NULL DEFAULT 0,
  lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-book, per-viewer reader settings (zoom, font, colors) that used to
-- live in localStorage. One row per (book, viewer) pair; the same table
-- serves the EPUB viewer ('epub'), the translation Markdown view ('markdown')
-- and the PDF viewer's reading theme ('pdf').
CREATE TABLE IF NOT EXISTS ReaderSettings (
  bookId        TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  viewer        TEXT NOT NULL,
  zoomPct       REAL NOT NULL DEFAULT 100,
  fontFamily    TEXT NOT NULL DEFAULT '',
  customBg      TEXT,
  customText    TEXT,
  pdfBackground TEXT,
  updatedAt     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bookId, viewer)
);

CREATE TABLE IF NOT EXISTS Translations (
  id           TEXT PRIMARY KEY,
  bookId       TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  sourceType   TEXT NOT NULL,
  method       TEXT NOT NULL,
  pageNumber   INTEGER,
  chunkKey     TEXT,
  sourceLang   TEXT NOT NULL,
  targetLang   TEXT NOT NULL,
  customPrompt TEXT NOT NULL DEFAULT '',
  markdown     TEXT NOT NULL,
  updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One translation per unit of content: per PDF page (chunkKey is '') or per
-- EPUB chunk (chunkKey = '<chapter>#<index>'). The method that produced it
-- (ocr / vision / chapter) is irrelevant — regenerating via another pipeline
-- replaces the row instead of adding a second one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_translations_lookup
  ON Translations (bookId, pageNumber, chunkKey);

CREATE TABLE IF NOT EXISTS AppSettings (
  theme    TEXT NOT NULL DEFAULT 'light',
  chatZoom INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS CustomInstructions (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  content   TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS AiModels (
  Id          TEXT PRIMARY KEY,
  DisplayName TEXT,
  URL         TEXT,
  ModelName   TEXT,
  APIKey      TEXT,
  Provider    TEXT NOT NULL,
  IsDefault   INTEGER NOT NULL DEFAULT 0
);

-- Per-book daily reading buckets (one row per book per local day, day is
-- "YYYY-MM-DD" computed in the worker). The source for the home daily-goal
-- ring and the weekly hours stats.
CREATE TABLE IF NOT EXISTS ReadingSessions (
  bookId  TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bookId, day)
);

-- The user's daily reading goal in minutes (single row).
CREATE TABLE IF NOT EXISTS ReadingGoals (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  goalMinutes INTEGER NOT NULL DEFAULT 30
);
`;

/** Runs `fn` with SQLite's foreign-key enforcement switched off, restoring it
 *  afterwards. Table rebuilds (migrations) need this so dropping a parent
 *  table while populated child tables reference it does not fail. `PRAGMA
 *  foreign_keys` cannot change inside a transaction, so toggling happens
 *  around it here. */
function withoutForeignKeys<T>(db: Database.Database, fn: () => T): T {
  db.pragma("foreign_keys = OFF");
  try {
    return fn();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/** Creates all tables if they do not exist yet, then runs migrations. */
export function applySchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  withoutForeignKeys(db, () => {
    ensureCoverImageTextColumn(db);
    ensureKindColumn(db);
    // The settings columns must exist before `ensureCascadeForeignKeys`
    // rebuilds `ReadingState` (its data copy selects them).
    ensureReadingStateSettingsColumns(db);
    ensureReadingStatePdfMethodColumn(db);
    ensureReadingStateModelIdsColumn(db);
    ensureCascadeForeignKeys(db);
    ensureReadingStateV2(db);
    ensureReadingStateStatsColumns(db);
    ensureAiModelDefaultColumn(db);
    ensureTranslationLookupIndex(db);
    ensureAppSettingsChatZoomColumn(db);
  });
}

/** Older databases created `Books.coverImage` as BLOB (covers were stored
 *  inline as data URLs). Rebuilds the table with a TEXT column when needed;
 *  values are re-normalized by `migrateLegacyCovers`. */
function ensureCoverImageTextColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(Books)") as Array<{ name: string; type: string }>;
  const column = columns.find((entry) => entry.name === "coverImage");
  if (!column || column.type.toUpperCase().includes("TEXT")) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE Books_new (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT 'Untitled',
        coverImage TEXT,
        kind       TEXT NOT NULL DEFAULT 'created',
        createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO Books_new (id, title, coverImage, createdAt, updatedAt)
        SELECT id, title, coverImage, createdAt, updatedAt FROM Books;
      DROP TABLE Books;
      ALTER TABLE Books_new RENAME TO Books;
    `);
  })();
}

/** Databases created before the `kind` column (`created` / `translated` /
 *  `reading`) lack it. Adds the column with the default value; existing rows
 *  are treated as plain created books. */
function ensureKindColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(Books)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "kind")) return;
  db.exec(`ALTER TABLE Books ADD COLUMN kind TEXT NOT NULL DEFAULT 'created'`);
}

function hasCascadeForeignKeys(db: Database.Database, table: string): boolean {
  const fks = db.pragma(`foreign_key_list(${table})`) as Array<{ on_delete: string }>;
  return fks.length > 0 && fks.every((fk) => fk.on_delete === "CASCADE");
}

/** Databases created before cascade rules lack `ON DELETE CASCADE` on child
 *  tables, so deleting a book would leave orphaned rows. Rebuilds the child
 *  tables with the cascade constraint when missing. */
function ensureCascadeForeignKeys(db: Database.Database): void {
  const tables = ["Documents", "DocumentSettings", "BookSources", "ReadingState"];
  if (tables.every((table) => hasCascadeForeignKeys(db, table))) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE ReadingState_new (
        bookId         TEXT PRIMARY KEY REFERENCES Books(id) ON DELETE CASCADE,
        currentPage    INTEGER NOT NULL DEFAULT 1,
        currentChapter TEXT NOT NULL DEFAULT '',
        ocrLangs       TEXT NOT NULL DEFAULT '["eng"]',
        sourceLang     TEXT NOT NULL DEFAULT '',
        targetLang     TEXT NOT NULL DEFAULT 'English',
        modelId        TEXT NOT NULL DEFAULT '',
        customPromptId TEXT NOT NULL DEFAULT '',
        pdfMethod      TEXT NOT NULL DEFAULT 'ocr',
        modelIds       TEXT NOT NULL DEFAULT '[]',
        totalPages     INTEGER NOT NULL DEFAULT 0,
        totalChapters  INTEGER NOT NULL DEFAULT 0,
        progressPercent REAL NOT NULL DEFAULT 0,
        readingSeconds INTEGER NOT NULL DEFAULT 0,
        lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ReadingState_new (
        bookId, currentPage, ocrLangs, sourceLang, targetLang,
        modelId, customPromptId, pdfMethod, modelIds, updatedAt
      )
        SELECT bookId, currentPage, ocrLangs, sourceLang, targetLang,
               modelId, customPromptId, pdfMethod, modelIds, updatedAt
        FROM ReadingState;
      DROP TABLE ReadingState;
      ALTER TABLE ReadingState_new RENAME TO ReadingState;

      CREATE TABLE BookSources_new (
        id         TEXT PRIMARY KEY,
        bookId     TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
        sourceType TEXT NOT NULL,
        filePath   TEXT NOT NULL,
        createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO BookSources_new (id, bookId, sourceType, filePath, createdAt)
        SELECT id, bookId, sourceType, filePath, createdAt FROM BookSources;
      DROP TABLE BookSources;
      ALTER TABLE BookSources_new RENAME TO BookSources;

      CREATE TABLE DocumentSettings_new (
        documentId   TEXT PRIMARY KEY REFERENCES Documents(id) ON DELETE CASCADE,
        layout       TEXT NOT NULL DEFAULT 'paged',
        pageFormat   TEXT NOT NULL DEFAULT 'a4',
        marginTop    REAL NOT NULL DEFAULT 12.7,
        marginRight  REAL NOT NULL DEFAULT 12.7,
        marginBottom REAL NOT NULL DEFAULT 12.7,
        marginLeft   REAL NOT NULL DEFAULT 12.7,
        zoomIndex    INTEGER NOT NULL DEFAULT 2,
        fontFamily   TEXT NOT NULL DEFAULT '',
        fontSize     REAL NOT NULL DEFAULT 14,
        updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO DocumentSettings_new (
        documentId, layout, pageFormat, marginTop, marginRight, marginBottom,
        marginLeft, zoomIndex, fontFamily, fontSize, updatedAt
      )
        SELECT documentId, layout, pageFormat, marginTop, marginRight, marginBottom,
               marginLeft, zoomIndex, fontFamily, fontSize, updatedAt
        FROM DocumentSettings;
      DROP TABLE DocumentSettings;
      ALTER TABLE DocumentSettings_new RENAME TO DocumentSettings;

      CREATE TABLE Documents_new (
        id          TEXT PRIMARY KEY,
        bookId      TEXT NOT NULL UNIQUE REFERENCES Books(id) ON DELETE CASCADE,
        contentJson TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO Documents_new (id, bookId, contentJson)
        SELECT id, bookId, contentJson FROM Documents;
      DROP TABLE Documents;
      ALTER TABLE Documents_new RENAME TO Documents;
    `);
  })();
}

/** Databases created before reading settings existed lack the translation
 *  columns on `ReadingState`. Adds them with defaults; existing rows keep
 *  their saved page/scroll state. `ensureReadingStateV2` later rebuilds the
 *  table when the v2 schema (chapter position, no scroll/customPrompt) is
 *  required. */
function ensureReadingStateSettingsColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  const addColumn = (name: string, definition: string) => {
    if (!has(name)) {
      db.exec(`ALTER TABLE ReadingState ADD COLUMN ${name} ${definition}`);
    }
  };
  addColumn("ocrLangs", "TEXT NOT NULL DEFAULT '[\"eng\"]'");
  addColumn("sourceLang", "TEXT NOT NULL DEFAULT ''");
  addColumn("targetLang", "TEXT NOT NULL DEFAULT 'English'");
  addColumn("modelId", "TEXT NOT NULL DEFAULT ''");
  addColumn("customPromptId", "TEXT NOT NULL DEFAULT ''");
}

/** Databases created before the PDF pipeline choice existed lack the
 *  `pdfMethod` column on `ReadingState`. Adds it with the default; existing
 *  rows keep their saved settings. Runs before the `ReadingState` rebuilds
 *  so their data copy carries the column over. */
function ensureReadingStatePdfMethodColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "pdfMethod")) return;
  db.exec("ALTER TABLE ReadingState ADD COLUMN pdfMethod TEXT NOT NULL DEFAULT 'ocr'");
}

/** Databases created before the ordered multi-model fallback existed lack
 *  the `modelIds` column on `ReadingState` (JSON array of model ids, in
 *  failover order; empty = app default). Adds it with the default; the
 *  legacy `modelId` column keeps the single choice for old readers. */
function ensureReadingStateModelIdsColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "modelIds")) return;
  db.exec("ALTER TABLE ReadingState ADD COLUMN modelIds TEXT NOT NULL DEFAULT '[]'");
}

/** Databases created before the v2 `ReadingState` schema carry the removed
 *  `scrollPosition` / `customPrompt` columns and lack `currentChapter` /
 *  `lastOpenedAt`. Rebuilds the table to the final shape; the position and
 *  translation settings survive, the dropped columns do not. */
function ensureReadingStateV2(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  const names = new Set(columns.map((entry) => entry.name));
  const hasOldColumns = names.has("scrollPosition") || names.has("customPrompt");
  const missesNewColumns = !names.has("currentChapter") || !names.has("lastOpenedAt");
  if (!hasOldColumns && !missesNewColumns) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE ReadingState_new (
        bookId         TEXT PRIMARY KEY REFERENCES Books(id) ON DELETE CASCADE,
        currentPage    INTEGER NOT NULL DEFAULT 1,
        currentChapter TEXT NOT NULL DEFAULT '',
        ocrLangs       TEXT NOT NULL DEFAULT '["eng"]',
        sourceLang     TEXT NOT NULL DEFAULT '',
        targetLang     TEXT NOT NULL DEFAULT 'English',
        modelId        TEXT NOT NULL DEFAULT '',
        customPromptId TEXT NOT NULL DEFAULT '',
        pdfMethod      TEXT NOT NULL DEFAULT 'ocr',
        modelIds       TEXT NOT NULL DEFAULT '[]',
        totalPages     INTEGER NOT NULL DEFAULT 0,
        totalChapters  INTEGER NOT NULL DEFAULT 0,
        progressPercent REAL NOT NULL DEFAULT 0,
        readingSeconds INTEGER NOT NULL DEFAULT 0,
        lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ReadingState_new (
        bookId, currentPage, ocrLangs, sourceLang, targetLang,
        modelId, customPromptId, pdfMethod, modelIds, updatedAt
      )
        SELECT bookId, currentPage, ocrLangs, sourceLang, targetLang,
               modelId, customPromptId, pdfMethod, modelIds, updatedAt
        FROM ReadingState;
      DROP TABLE ReadingState;
      ALTER TABLE ReadingState_new RENAME TO ReadingState;
    `);
  })();
}

/** Databases created before the reading-stats columns existed (`totalPages`,
 *  `totalChapters`, `readingSeconds`, `progressPercent`) lack them. Adds the
 *  columns with defaults; existing rows start at zero. */
function ensureReadingStateStatsColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  if (has("totalPages") && has("totalChapters") && has("readingSeconds") && has("progressPercent")) return;
  db.transaction(() => {
    if (!has("totalPages")) db.exec("ALTER TABLE ReadingState ADD COLUMN totalPages INTEGER NOT NULL DEFAULT 0");
    if (!has("totalChapters")) db.exec("ALTER TABLE ReadingState ADD COLUMN totalChapters INTEGER NOT NULL DEFAULT 0");
    if (!has("progressPercent")) db.exec("ALTER TABLE ReadingState ADD COLUMN progressPercent REAL NOT NULL DEFAULT 0");
    if (!has("readingSeconds")) db.exec("ALTER TABLE ReadingState ADD COLUMN readingSeconds INTEGER NOT NULL DEFAULT 0");
  })();
}

/** Translations used to be indexed on `(bookId, method, pageNumber,
 *  chunkKey)`, letting one page hold both an OCR and an AI-vision row — and
 *  PDF rows stored `chunkKey IS NULL`, which a unique index treats as
 *  never-equal, so upserts could not replace them either. Rebuilds the index
 *  without the method column (one row per page / chunk) and cleans up
 *  pre-existing duplicates (keeping the newest). */
function ensureTranslationLookupIndex(db: Database.Database): void {
  const columns = db.pragma("index_info(idx_translations_lookup)") as Array<{ name: string }>;
  if (columns.length === 3) return;
  db.exec(`
    UPDATE Translations SET chunkKey = '' WHERE pageNumber IS NOT NULL AND chunkKey IS NULL;
    DELETE FROM Translations
      WHERE rowid NOT IN (
        SELECT MAX(rowid) FROM Translations GROUP BY bookId, pageNumber, chunkKey
      );
    DROP INDEX IF EXISTS idx_translations_lookup;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_translations_lookup
      ON Translations (bookId, pageNumber, chunkKey);
  `);
}

/** Databases created before the default-model concept lack `IsDefault` on
 *  `AiModels`. Adds the column; existing models keep their order. */
function ensureAiModelDefaultColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(AiModels)") as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === "IsDefault")) {
    db.exec("ALTER TABLE AiModels ADD COLUMN IsDefault INTEGER NOT NULL DEFAULT 0");
  }
}

/** Databases created before the AI chat zoom existed lack `chatZoom` on
 *  `AppSettings`. Adds it with the default; the single settings row keeps
 *  its theme. */
function ensureAppSettingsChatZoomColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(AppSettings)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "chatZoom")) return;
  db.exec("ALTER TABLE AppSettings ADD COLUMN chatZoom INTEGER NOT NULL DEFAULT 100");
}
