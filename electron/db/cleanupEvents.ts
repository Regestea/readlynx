import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FileStore } from "../store/FileStore.ts";
import { removeCoverFile } from "./covers.ts";
import { removeSourceFile } from "./sources.ts";
import {
  deleteAllBookTranslationImages,
  deleteTranslationImages,
} from "../store/translationImageStore.ts";
import type {
  CleanupEventType,
  RemoveFilesPayload,
  RemoveTranslationImagesPayload,
  RemoveRendererScrollKeysPayload,
  RendererCleanupEvent,
  SourceImportedPayload,
} from "../../src/infrastructure/db/entities/types.ts";

/** The cleanup journal.
 *
 *  Side effects that live outside the database — store files, cached
 *  translation images, the renderer's localStorage — are recorded as rows
 *  in `CleanupEvents` in the same transaction that removes the references
 *  (the book row, the source row, the translation rows). A replay pass
 *  performs the recorded work and then deletes each performed row entirely,
 *  so the table only ever holds pending work. Because "work done" and "row
 *  deleted" cannot be atomic, every handler is idempotent: replaying an
 *  event whose work already happened is a safe no-op, which is also what
 *  makes a crash mid-replay indistinguishable from the work being complete.
 *  Events whose type starts with `renderer-` are skipped here and consumed
 *  by the shell window instead (localStorage is unreachable from here). */

/** Event types consumed by the renderer rather than replayed here. */
const RENDERER_EVENT_PREFIX = "renderer-";

interface PendingRow {
  id: string;
  type: string;
  payload: string;
}

/** Records an event. Called inside the caller's transaction when the event
 *  must be atomic with a row change, or standalone (autocommit) when the
 *  journaled side effect — the place that calls it — follows afterwards.
 *  Handlers cast the decoded `payload` themselves, so unknown growth keeps
 *  being possible without touching this function. */
export function emitCleanupEvent(
  db: Database.Database,
  type: CleanupEventType,
  payload: unknown,
): void {
  db.prepare(
    "INSERT INTO CleanupEvents (id, type, payload) VALUES (?, ?, ?)",
  ).run(randomUUID(), type, JSON.stringify(payload));
}

/** Deletes a `source-imported` event for a store key. Called inside the
 *  create-book transaction: the book row that landed is the claim — the
 *  recorded copy now belongs to the book, and the replay must not delete
 *  it. When the create failed instead (the row never landed), the same
 *  handler replays later and removes the unclaimed copy. */
export function claimSourceImportedEvent(db: Database.Database, key: string): void {
  db.prepare(
    `DELETE FROM CleanupEvents
      WHERE type = 'source-imported' AND json_extract(payload, '$.key') = ?`,
  ).run(key);
}

/** True when a `BookSources` row points at this exact store key. */
function sourceKeyReferenced(db: Database.Database, key: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM BookSources WHERE filePath = ?")
    .get(key) as { n: number };
  return row.n > 0;
}

/** Removes one journaled `source-imported` copy: only when no book row
 *  claims it (the create never landed or the claim-delete never ran). */
function replaySourceImported(db: Database.Database, store: FileStore, key: string): void {
  if (sourceKeyReferenced(db, key)) return;
  try {
    const fileName = key.slice("books/".length);
    store.delete("books", fileName);
  } catch {
    // Best effort — the next replay gets another chance.
  }
}

function replayRemoveFiles(store: FileStore, payload: RemoveFilesPayload): void {
  for (const filePath of payload.paths) {
    try {
      if (filePath.startsWith("covers/")) removeCoverFile(filePath, store);
      else removeSourceFile(filePath, store);
    } catch {
      // Best effort — the next replay gets another chance.
    }
  }
}

function replayRemoveTranslationImages(store: FileStore, payload: RemoveTranslationImagesPayload): void {
  if (payload.prefix) deleteTranslationImages(store, payload.bookId, payload.prefix);
  else deleteAllBookTranslationImages(store, payload.bookId);
}

interface CleanupEventContext {
  db: Database.Database;
  store: FileStore;
}

/** Performs every pending event that belongs here and deletes its row.
 *  A handler that throws leaves its row pending (retried at the next
 *  launch) without blocking the others. Events meant for the renderer are
 *  left for the shell window to consume. */
export function processCleanupEvents({ db, store }: CleanupEventContext): void {
  // Another process instance (the main-process store saves translation
  // images) may have written entries after this worker booted; replaying
  // from a stale manifest would miss them.
  store.refreshManifest();
  const rows = db
    .prepare("SELECT id, type, payload FROM CleanupEvents ORDER BY createdAt, id")
    .all() as PendingRow[];
  if (rows.length === 0) return;

  const handled: string[] = [];
  for (const row of rows) {
    if (row.type.startsWith(RENDERER_EVENT_PREFIX)) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      continue;
    }
    try {
      switch (row.type as CleanupEventType) {
        case "source-imported":
          replaySourceImported(db, store, (payload as SourceImportedPayload).key);
          break;
        case "remove-files":
          replayRemoveFiles(store, payload as RemoveFilesPayload);
          break;
        case "remove-translation-images":
          replayRemoveTranslationImages(store, payload as RemoveTranslationImagesPayload);
          break;
        default:
          // An unknown type from an older/newer build: leave it pending
          // rather than dropping a record replay may still need.
          continue;
      }
      handled.push(row.id);
    } catch {
      // Keep the row; the next launch's replay retries this one.
    }
  }
  if (handled.length === 0) return;
  const drop = db.prepare("DELETE FROM CleanupEvents WHERE id = ?");
  db.transaction(() => {
    for (const id of handled) drop.run(id);
  })();
}

/** Pending events for the renderer. Called by the shell after mounting. */
export function listRendererCleanupEvents(db: Database.Database): RendererCleanupEvent[] {
  const rows = db
    .prepare(
      `SELECT id, payload FROM CleanupEvents
        WHERE type = 'renderer-remove-scroll-keys' ORDER BY createdAt, id`,
    )
    .all() as Array<{ id: string; payload: string }>;
  const events: RendererCleanupEvent[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as RemoveRendererScrollKeysPayload;
      if (typeof payload.bookId === "string" && payload.bookId) {
        events.push({ id: row.id, bookId: payload.bookId });
      }
    } catch {
      // Undecodable payload: leave the row for manual inspection.
    }
  }
  return events;
}

/** Deletes the renderer-consumed event rows. Scoped to renderer events so a
 *  misbehaving renderer window cannot ack away worker-side journal work. */
export function ackRendererCleanupEvents(db: Database.Database, ids: string[]): boolean {
  if (ids.length === 0) return true;
  const drop = db.prepare("DELETE FROM CleanupEvents WHERE id = ? AND type = ?");
  db.transaction(() => {
    for (const id of ids) drop.run(id, "renderer-remove-scroll-keys");
  })();
  return true;
}
