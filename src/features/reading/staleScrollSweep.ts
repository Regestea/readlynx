import { forgetBookScrollMemory, SCROLL_MEMORY_PREFIX } from "./scrollMemory";

/** A version-4 uuid, as every book id and therefore every scroll key
 *  carries. Captured from the key rather than split on ":" — the unit part
 *  (EPUB chunks, chapter keys) may contain colons itself. */
const BOOK_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Consumes the cleanup journal's renderer events: every deletion of a book
 *  row (temporary purge or manual) recorded a `renderer-remove-scroll-keys`
 *  event transactionally, and the shell window is the only place able to
 *  act on it. Failed tells are retried next boot (dropping a key that no
 *  longer exists is a no-op), and acknowledged event rows are dropped from
 *  the journal entirely. */
export async function consumeRendererCleanupEvents(): Promise<void> {
  const db = window.readlynx?.db;
  if (!db?.listRendererCleanupEvents) return;
  const events = await db.listRendererCleanupEvents().catch(() => []);
  if (events.length === 0) return;
  for (const { bookId } of events) forgetBookScrollMemory(bookId);
  await db.ackCleanupEvents?.(events.map((event) => event.id)).catch(() => false);
}

/** Journal events cover every deletion since the journal existed; this
 *  sweep still walks the leftover keys from deletions performed before
 *  then, and it answers book ids whose keys landed without a matching
 *  event for any other reason. Runs once per shell boot, before any
 *  temporary import of the session exists — and a key's first write
 *  happens long after its book row landed, so `getBook` answers cover live
 *  temporary books (the lookup has no temporary filter) while purged ids
 *  come back null. Returns how many entries were dropped. */

/** Deletes scroll-ratio localStorage entries whose book no longer has a row:
 *  deleted books, and session-only "Open with" imports purged at launch.
 *  Without this the keys would linger forever. Runs once per shell boot —
 *  before any temporary import of the session exists, and a key's first
 *  write happens long after its book row landed, so `getBook` answers cover
 *  live temporary books (the lookup has no temporary filter) while purged
 *  ids come back null. Returns how many entries were dropped. */
export async function sweepStaleScrollMemory(): Promise<number> {
  const db = window.readlynx?.db;
  if (!db || typeof localStorage === "undefined") return 0;

  const prefixLength = SCROLL_MEMORY_PREFIX.length;
  const keysByBookId = new Map<string, string[]>();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(`${SCROLL_MEMORY_PREFIX}:`)) continue;
    const bookId = BOOK_ID_PATTERN.exec(key.slice(prefixLength))?.[0];
    if (!bookId) continue;
    const keys = keysByBookId.get(bookId) ?? [];
    keys.push(key);
    keysByBookId.set(bookId, keys);
  }
  if (keysByBookId.size === 0) return 0;

  const aliveBookIds = new Set<string>();
  await Promise.all(
    Array.from(keysByBookId.keys()).map(async (bookId) => {
      try {
        const book = await db.getBook(bookId);
        if (book) aliveBookIds.add(bookId);
      } catch {
        // A failing lookup must not delete memory: treat the book as alive.
      }
    }),
  );

  let removed = 0;
  for (const [bookId, keys] of keysByBookId) {
    if (aliveBookIds.has(bookId)) continue;
    for (const key of keys) {
      localStorage.removeItem(key);
      removed += 1;
    }
  }
  return removed;
}
