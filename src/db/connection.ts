import Database from "better-sqlite3";

/** Opens the SQLite database file and applies connection-level pragmas.
 *  Runs inside the DB worker thread (better-sqlite3 is a native module). */
export function createConnection(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
