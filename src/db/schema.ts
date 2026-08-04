import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Books (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  coverImage BLOB,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Documents (
  id          TEXT PRIMARY KEY,
  bookId      TEXT NOT NULL UNIQUE REFERENCES Books(id),
  contentJson TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS DocumentSettings (
  documentId   TEXT PRIMARY KEY REFERENCES Documents(id),
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
  bookId     TEXT NOT NULL REFERENCES Books(id),
  sourceType TEXT NOT NULL,
  filePath   TEXT NOT NULL,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ReadingState (
  bookId         TEXT PRIMARY KEY REFERENCES Books(id),
  currentPage    INTEGER NOT NULL DEFAULT 1,
  scrollPosition REAL NOT NULL DEFAULT 0,
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS AppSettings (
  theme TEXT NOT NULL DEFAULT 'light'
);
`;

/** Creates all tables if they do not exist yet. */
export function applySchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}
