import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Books (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  coverImage TEXT,
  kind       TEXT NOT NULL DEFAULT 'created',
  isPinned   INTEGER NOT NULL DEFAULT 0,
  pinnedAt   TEXT,
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
  id           TEXT PRIMARY KEY,
  bookId       TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  sourceType   TEXT NOT NULL,
  filePath     TEXT NOT NULL,
  fileHash     TEXT,
  fileSize     INTEGER,
  originalPath TEXT,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
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
  epubExtraction TEXT NOT NULL DEFAULT 'markdown',
  pdfAutoFigures INTEGER NOT NULL DEFAULT 1,
  pdfScanRegion  TEXT NOT NULL DEFAULT '',
  modelIds       TEXT NOT NULL DEFAULT '[]',
  totalPages     INTEGER NOT NULL DEFAULT 0,
  totalChapters  INTEGER NOT NULL DEFAULT 0,
  progressPercent REAL NOT NULL DEFAULT 0,
  maxProgress    REAL NOT NULL DEFAULT 0,
  finished       INTEGER NOT NULL DEFAULT 0,
  lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-book, per-viewer reader settings (zoom, font, colors) that used to
-- live in localStorage. One row per (book, viewer) pair; the same table
-- serves the EPUB viewer ('epub'), the translation Markdown view ('markdown'),
-- the PDF viewer's reading theme ('pdf') and the per-book global image zoom
-- ('image', only its zoomPct column is used).
CREATE TABLE IF NOT EXISTS ReaderSettings (
  bookId            TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  viewer            TEXT NOT NULL,
  zoomPct           REAL NOT NULL DEFAULT 100,
  fontFamily        TEXT NOT NULL DEFAULT '',
  customBg          TEXT,
  customText        TEXT,
  textHardOverride  INTEGER NOT NULL DEFAULT 0,
  softBookColors    INTEGER NOT NULL DEFAULT 1,
  pdfBackground     TEXT,
  codeTheme         TEXT,
  diagramTheme      TEXT,
  codeBackground    TEXT,
  diagramBackground TEXT,
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bookId, viewer)
);

-- Global reader defaults (one row per viewer). Books without a per-book
-- ReaderSettings row fall back to these values, so newly added books pick
-- up the Settings-page defaults until the user customizes them per book.
CREATE TABLE IF NOT EXISTS ReaderDefaults (
  viewer            TEXT PRIMARY KEY,
  zoomPct           REAL NOT NULL DEFAULT 100,
  fontFamily        TEXT NOT NULL DEFAULT '',
  customBg          TEXT,
  customText        TEXT,
  textHardOverride  INTEGER NOT NULL DEFAULT 0,
  softBookColors    INTEGER NOT NULL DEFAULT 1,
  pdfBackground     TEXT,
  codeTheme         TEXT,
  diagramTheme      TEXT,
  codeBackground    TEXT,
  diagramBackground TEXT,
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Ledger of actually-counted reading segments (epoch ms, wall-clock time).
-- Written by heartbeats while the book is open and activity is detected.
-- Daily totals (the home daily-goal ring and the weekly hours stats) are
-- computed from these rows on read, so totals stay auditable and
-- recomputable.
CREATE TABLE IF NOT EXISTS ReadingEvents (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  bookId    TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
  startedAt INTEGER NOT NULL,
  endedAt   INTEGER NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  CHECK (endedAt > startedAt)
);

CREATE INDEX IF NOT EXISTS idx_reading_events_book
  ON ReadingEvents (bookId, endedAt);

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
    ensureReadingStateEpubExtractionColumn(db);
    ensureReadingStatePdfAutoFiguresColumn(db);
    ensureReadingStatePdfScanRegionColumn(db);
    ensureReadingStateProgressColumns(db);
    ensureBookSourceIdentityColumns(db);
    ensureCascadeForeignKeys(db);
    ensureReadingStateV2(db);
    ensureReadingStateStatsColumns(db);
    ensureReadingStateDropsReadingSeconds(db);
    ensureReadingStateProgressBackfill(db);
    ensureReadingEventsTable(db);
    migrateReadingSessionsToEvents(db);
    ensureAiModelDefaultColumn(db);
    ensureTranslationLookupIndex(db);
    ensureAppSettingsChatZoomColumn(db);
    ensureReaderSettingsHardOverrideColumn(db);
    ensureReaderDefaultsTable(db);
    ensureReaderSettingsBlockColumns(db);
    ensureReaderDefaultsBlockColumns(db);
    ensureReaderSoftBookColorsColumn(db);
    ensureBookPinColumns(db);
  });
}

/** Older databases created `Books.coverImage` as BLOB (covers were stored
 *  inline as data URLs). Rebuilds the table with a TEXT column when needed;
 *  values are re-normalized by `migrateLegacyCovers`. */
function ensureCoverImageTextColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(Books)") as Array<{ name: string; type: string }>;
  const column = columns.find((entry) => entry.name === "coverImage");
  if (!column || column.type.toUpperCase().includes("TEXT")) return;
  const names = new Set(columns.map((entry) => entry.name));
  const hasPin = names.has("isPinned") && names.has("pinnedAt");
  db.transaction(() => {
    db.exec(`
      CREATE TABLE Books_new (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT 'Untitled',
        coverImage TEXT,
        kind       TEXT NOT NULL DEFAULT 'created',
        isPinned   INTEGER NOT NULL DEFAULT 0,
        pinnedAt   TEXT,
        createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO Books_new (id, title, coverImage, createdAt, updatedAt${hasPin ? ", isPinned, pinnedAt" : ""})
        SELECT id, title, coverImage, createdAt, updatedAt${hasPin ? ", isPinned, pinnedAt" : ""} FROM Books;
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

/** Databases created before external "Open with" support lack the content
 *  identity columns on `BookSources` (`fileHash` = sha256 of the imported
 *  bytes, `fileSize` = byte length, `originalPath` = where the file was
 *  picked from). Adds them as nullable — pre-existing rows keep `NULL`
 *  (they simply never match a hash lookup) — plus the lookup indexes.
 *  Runs before `ensureCascadeForeignKeys` so its table rebuild carries the
 *  columns over. */
function ensureBookSourceIdentityColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(BookSources)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  db.transaction(() => {
    if (!has("fileHash")) db.exec("ALTER TABLE BookSources ADD COLUMN fileHash TEXT");
    if (!has("fileSize")) db.exec("ALTER TABLE BookSources ADD COLUMN fileSize INTEGER");
    if (!has("originalPath")) db.exec("ALTER TABLE BookSources ADD COLUMN originalPath TEXT");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_book_sources_hash
      ON BookSources (fileHash, fileSize)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_book_sources_original
      ON BookSources (originalPath)`);
  })();
}

/** Databases created before the monotonic progress columns existed lack
 *  `maxProgress` (highest position reached, 0..1) and `finished` (closed at
 *  >= 95%). Adds them with defaults. Runs before the `ReadingState`
 *  rebuilds so their data copy carries the columns over. */
function ensureReadingStateProgressColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  if (has("maxProgress") && has("finished")) return;
  db.transaction(() => {
    if (!has("maxProgress")) db.exec("ALTER TABLE ReadingState ADD COLUMN maxProgress REAL NOT NULL DEFAULT 0");
    if (!has("finished")) db.exec("ALTER TABLE ReadingState ADD COLUMN finished INTEGER NOT NULL DEFAULT 0");
  })();
}

/** Backfills the monotonic progress from the stored position for books
 *  tracked before the columns existed, and marks books already closed at
 *  >= 95% as finished. Idempotent (never lowers an existing max). */
function ensureReadingStateProgressBackfill(db: Database.Database): void {
  db.exec(`
    UPDATE ReadingState SET
      maxProgress = MAX(maxProgress, MAX(
        progressPercent,
        CASE WHEN totalPages > 0 THEN CAST(currentPage AS REAL) / totalPages ELSE 0 END
      )),
      finished = CASE WHEN maxProgress >= 0.95 THEN 1 ELSE finished END;
  `);
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
        epubExtraction TEXT NOT NULL DEFAULT 'markdown',
        pdfAutoFigures INTEGER NOT NULL DEFAULT 1,
        pdfScanRegion  TEXT NOT NULL DEFAULT '',
        modelIds       TEXT NOT NULL DEFAULT '[]',
        totalPages     INTEGER NOT NULL DEFAULT 0,
        totalChapters  INTEGER NOT NULL DEFAULT 0,
        progressPercent REAL NOT NULL DEFAULT 0,
        maxProgress    REAL NOT NULL DEFAULT 0,
        finished       INTEGER NOT NULL DEFAULT 0,
        lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ReadingState_new (
        bookId, currentPage, ocrLangs, sourceLang, targetLang,
        modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, maxProgress,
        finished, updatedAt
      )
        SELECT bookId, currentPage, ocrLangs, sourceLang, targetLang,
               modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, maxProgress,
               finished, updatedAt
        FROM ReadingState;
      DROP TABLE ReadingState;
      ALTER TABLE ReadingState_new RENAME TO ReadingState;

      CREATE TABLE BookSources_new (
        id           TEXT PRIMARY KEY,
        bookId       TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
        sourceType   TEXT NOT NULL,
        filePath     TEXT NOT NULL,
        fileHash     TEXT,
        fileSize     INTEGER,
        originalPath TEXT,
        createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO BookSources_new (id, bookId, sourceType, filePath, fileHash, fileSize, originalPath, createdAt)
        SELECT id, bookId, sourceType, filePath, fileHash, fileSize, originalPath, createdAt FROM BookSources;
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

/** Databases created before the Original-HTML EPUB extraction existed lack
 *  the `epubExtraction` column on `ReadingState` ("markdown" = converted,
 *  "html" = the chapter's cleaned original tags). Adds it with the default;
 *  existing rows keep converted Markdown. Runs before the `ReadingState`
 *  rebuilds so their data copy carries the column over. */
function ensureReadingStateEpubExtractionColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "epubExtraction")) return;
  db.exec("ALTER TABLE ReadingState ADD COLUMN epubExtraction TEXT NOT NULL DEFAULT 'markdown'");
}

/** Databases created before the AI-vision figure handling existed lack the
 *  `pdfAutoFigures` column on `ReadingState` (1 = splice untranslatable
 *  figures into the translation, 0 = plain page-image translation). Adds it
 *  defaulting to on (1); existing rows keep the current behavior. Runs
 *  before the `ReadingState` rebuilds so their data copy carries the column
 *  over. */
function ensureReadingStatePdfAutoFiguresColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "pdfAutoFigures")) return;
  db.exec("ALTER TABLE ReadingState ADD COLUMN pdfAutoFigures INTEGER NOT NULL DEFAULT 1");
}

/** Databases created before the PDF scan region existed lack the
 *  `pdfScanRegion` column on `ReadingState` (JSON `{x, y, w, h}` in page
 *  fractions; empty = the whole page). Added empty, so existing books keep
 *  scanning full pages. Runs before the `ReadingState` rebuilds so their data
 *  copy carries the column over. */
function ensureReadingStatePdfScanRegionColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "pdfScanRegion")) return;
  db.exec("ALTER TABLE ReadingState ADD COLUMN pdfScanRegion TEXT NOT NULL DEFAULT ''");
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
        epubExtraction TEXT NOT NULL DEFAULT 'markdown',
        pdfAutoFigures INTEGER NOT NULL DEFAULT 1,
        pdfScanRegion  TEXT NOT NULL DEFAULT '',
        modelIds       TEXT NOT NULL DEFAULT '[]',
        totalPages     INTEGER NOT NULL DEFAULT 0,
        totalChapters  INTEGER NOT NULL DEFAULT 0,
        progressPercent REAL NOT NULL DEFAULT 0,
        maxProgress    REAL NOT NULL DEFAULT 0,
        finished       INTEGER NOT NULL DEFAULT 0,
        lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ReadingState_new (
        bookId, currentPage, ocrLangs, sourceLang, targetLang,
        modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, maxProgress,
        finished, updatedAt
      )
        SELECT bookId, currentPage, ocrLangs, sourceLang, targetLang,
               modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, maxProgress,
               finished, updatedAt
        FROM ReadingState;
      DROP TABLE ReadingState;
      ALTER TABLE ReadingState_new RENAME TO ReadingState;
    `);
  })();
}

/** Databases created before the reading-stats columns existed (`totalPages`,
 *  `totalChapters`, `progressPercent`) lack them. Adds the columns with
 *  defaults; existing rows start at zero. (`readingSeconds` used to be
 *  managed here too — the event-ledger migration removes it instead.) */
function ensureReadingStateStatsColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  if (has("totalPages") && has("totalChapters") && has("progressPercent")) return;
  db.transaction(() => {
    if (!has("totalPages")) db.exec("ALTER TABLE ReadingState ADD COLUMN totalPages INTEGER NOT NULL DEFAULT 0");
    if (!has("totalChapters")) db.exec("ALTER TABLE ReadingState ADD COLUMN totalChapters INTEGER NOT NULL DEFAULT 0");
    if (!has("progressPercent")) db.exec("ALTER TABLE ReadingState ADD COLUMN progressPercent REAL NOT NULL DEFAULT 0");
  })();
}

/** The cumulative `readingSeconds` column is superseded by the
 *  `ReadingEvents` ledger (which also feeds the daily totals). Drops the
 *  column via a table rebuild; historical daily totals are preserved by
 *  `migrateReadingSessionsToEvents`. Runs after
 *  `ensureReadingStateStatsColumns` so freshly-added columns survive the
 *  copy. */
function ensureReadingStateDropsReadingSeconds(db: Database.Database): void {
  const columns = db.pragma("table_info(ReadingState)") as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === "readingSeconds")) return;
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
        epubExtraction TEXT NOT NULL DEFAULT 'markdown',
        pdfAutoFigures INTEGER NOT NULL DEFAULT 1,
        pdfScanRegion  TEXT NOT NULL DEFAULT '',
        modelIds       TEXT NOT NULL DEFAULT '[]',
        totalPages     INTEGER NOT NULL DEFAULT 0,
        totalChapters  INTEGER NOT NULL DEFAULT 0,
        progressPercent REAL NOT NULL DEFAULT 0,
        maxProgress    REAL NOT NULL DEFAULT 0,
        finished       INTEGER NOT NULL DEFAULT 0,
        lastOpenedAt   TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ReadingState_new (
        bookId, currentPage, ocrLangs, sourceLang, targetLang,
        modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, totalPages,
        totalChapters, progressPercent, maxProgress, finished,
        lastOpenedAt, updatedAt
      )
        SELECT bookId, currentPage, ocrLangs, sourceLang, targetLang,
               modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, totalPages,
               totalChapters, progressPercent, maxProgress, finished,
               lastOpenedAt, updatedAt
        FROM ReadingState;
      DROP TABLE ReadingState;
      ALTER TABLE ReadingState_new RENAME TO ReadingState;
    `);
  })();
}

/** Databases created before the event ledger existed lack the
 *  `ReadingEvents` table and its lookup index. Creates them. */
function ensureReadingEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ReadingEvents (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      bookId    TEXT NOT NULL REFERENCES Books(id) ON DELETE CASCADE,
      startedAt INTEGER NOT NULL,
      endedAt   INTEGER NOT NULL,
      seconds   INTEGER NOT NULL DEFAULT 0,
      CHECK (endedAt > startedAt)
    );
    CREATE INDEX IF NOT EXISTS idx_reading_events_book
      ON ReadingEvents (bookId, endedAt);
  `);
}

/** The daily buckets used to be written eagerly into `ReadingSessions`. The
 *  event ledger supersedes them: legacy bucket rows are backfilled as
 *  synthetic events (one per bucket day, spanning from that day's local
 *  midnight for the recorded seconds — daily totals survive), then the table
 *  is dropped. Runs after `ensureReadingEventsTable`. */
function migrateReadingSessionsToEvents(db: Database.Database): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ReadingSessions'")
    .get();
  if (!table) return;
  db.transaction(() => {
    const rows = db
      .prepare("SELECT bookId, day, seconds FROM ReadingSessions")
      .all() as Array<{ bookId: string; day: string; seconds: number }>;
    const insert = db.prepare(
      `INSERT INTO ReadingEvents (bookId, startedAt, endedAt, seconds) VALUES (?, ?, ?, ?)`,
    );
    for (const row of rows) {
      if (row.seconds <= 0) continue;
      const start = new Date(`${row.day}T00:00:00`).getTime();
      insert.run(row.bookId, start, start + row.seconds * 1000, row.seconds);
    }
    db.exec("DROP TABLE ReadingSessions");
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

/** Databases created before the EPUB hard text-color override existed lack
 *  `textHardOverride` on `ReaderSettings`. Adds it defaulting to off (0);
 *  existing books keep their saved colors. */
function ensureReaderSettingsHardOverrideColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(ReaderSettings)") as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "textHardOverride")) return;
  db.exec("ALTER TABLE ReaderSettings ADD COLUMN textHardOverride INTEGER NOT NULL DEFAULT 0");
}

/** Databases created before global reader defaults existed lack the
 *  `ReaderDefaults` table. Creates it; existing per-book settings are
 *  untouched and keep winning over the defaults. */
function ensureReaderDefaultsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ReaderDefaults (
      viewer            TEXT PRIMARY KEY,
      zoomPct           REAL NOT NULL DEFAULT 100,
      fontFamily        TEXT NOT NULL DEFAULT '',
      customBg          TEXT,
      customText        TEXT,
      textHardOverride  INTEGER NOT NULL DEFAULT 0,
      softBookColors    INTEGER NOT NULL DEFAULT 1,
      pdfBackground     TEXT,
      codeTheme         TEXT,
      diagramTheme      TEXT,
      codeBackground    TEXT,
      diagramBackground TEXT,
      updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Databases created before Markdown code/diagram appearance settings
 *  existed lack the four block columns. Adds them as nullable (null =
 *  follow the app theme); existing rows keep their saved colors. */
function ensureReaderSettingsBlockColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(ReaderSettings)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  db.transaction(() => {
    if (!has("codeTheme")) db.exec("ALTER TABLE ReaderSettings ADD COLUMN codeTheme TEXT");
    if (!has("diagramTheme")) db.exec("ALTER TABLE ReaderSettings ADD COLUMN diagramTheme TEXT");
    if (!has("codeBackground")) db.exec("ALTER TABLE ReaderSettings ADD COLUMN codeBackground TEXT");
    if (!has("diagramBackground"))
      db.exec("ALTER TABLE ReaderSettings ADD COLUMN diagramBackground TEXT");
  })();
}

/** Same backfill for the global `ReaderDefaults` table. */
function ensureReaderDefaultsBlockColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(ReaderDefaults)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  db.transaction(() => {
    if (!has("codeTheme")) db.exec("ALTER TABLE ReaderDefaults ADD COLUMN codeTheme TEXT");
    if (!has("diagramTheme")) db.exec("ALTER TABLE ReaderDefaults ADD COLUMN diagramTheme TEXT");
    if (!has("codeBackground")) db.exec("ALTER TABLE ReaderDefaults ADD COLUMN codeBackground TEXT");
    if (!has("diagramBackground"))
      db.exec("ALTER TABLE ReaderDefaults ADD COLUMN diagramBackground TEXT");
  })();
}

/** Databases created before the EPUB soft-colors option existed lack
 *  `softBookColors` on both reader stores. Adds it defaulting to on (1), which
 *  is the app-wide default: every existing book gets the soft reading inks, and
 *  a reader who prefers the publisher's palette switches it off per book or in
 *  Settings → EPUB defaults. */
function ensureReaderSoftBookColorsColumn(db: Database.Database): void {
  for (const table of ["ReaderSettings", "ReaderDefaults"]) {
    const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (columns.some((entry) => entry.name === "softBookColors")) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN softBookColors INTEGER NOT NULL DEFAULT 1`);
  }
}

/** Databases created before book pinning lack `isPinned` / `pinnedAt` on
 *  `Books`. Adds them with defaults (unpinned); existing rows keep their
 *  shelf order. */
function ensureBookPinColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(Books)") as Array<{ name: string }>;
  const has = (name: string) => columns.some((entry) => entry.name === name);
  db.transaction(() => {
    if (!has("isPinned")) db.exec("ALTER TABLE Books ADD COLUMN isPinned INTEGER NOT NULL DEFAULT 0");
    if (!has("pinnedAt")) db.exec("ALTER TABLE Books ADD COLUMN pinnedAt TEXT");
  })();
}


