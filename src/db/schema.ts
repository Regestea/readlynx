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
  scrollPosition REAL NOT NULL DEFAULT 0,
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS AppSettings (
  theme TEXT NOT NULL DEFAULT 'light'
);

CREATE TABLE IF NOT EXISTS AiModels (
  Id          TEXT PRIMARY KEY,
  DisplayName TEXT,
  URL         TEXT,
  ModelName   TEXT,
  APIKey      TEXT,
  Provider    TEXT NOT NULL
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
    ensureCascadeForeignKeys(db);
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
        scrollPosition REAL NOT NULL DEFAULT 0,
        updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ReadingState_new (bookId, currentPage, scrollPosition, updatedAt)
        SELECT bookId, currentPage, scrollPosition, updatedAt FROM ReadingState;
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
