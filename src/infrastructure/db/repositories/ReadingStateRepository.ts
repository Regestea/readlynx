import type Database from "better-sqlite3";
import type { ReadingStateEntity } from "../entities/index.ts";
import type { ReadingDayBucket, ReadingProgressRow, ReadingWeekSummary } from "../entities/types.ts";

const DEFAULT_OCR_LANGS = ["eng"];
const DEFAULT_GOAL_MINUTES = 30;

/** Local calendar date as "YYYY-MM-DD" — the key used by the daily reading
 *  buckets. Computed in local time so a day rolls over at midnight for the
 *  user, not at UTC midnight. */
export function localDayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Settings a book keeps between reading sessions. Every field is optional:
 *  partial updates only touch the columns they carry, so the position
 *  pipeline (page / chapter) and the settings pipeline (model, instruction,
 *  languages) can write independently without clobbering each other. */
export interface ReadingStateInput {
  /** Last PDF page read (1-based). */
  currentPage?: number;
  /** Last EPUB chapter read (spine index as a string). */
  currentChapter?: string;
  ocrLangs?: string[];
  /** Deprecated — kept for the column's NOT NULL; the app no longer asks
   *  for a source language (auto-detect is always used). */
  sourceLang?: string;
  targetLang?: string;
  /** Chosen AI model id ("" = app default). */
  modelId?: string;
  /** Chosen saved instruction id ("" = no instruction). */
  customPromptId?: string;
  /** Total pages of the source PDF — set once the document loads. */
  totalPages?: number;
  /** Total chapters of the source EPUB — set once the book loads. */
  totalChapters?: number;
  /** Real reading progress 0..1 for EPUB books (epubjs location percentage). */
  progressPercent?: number;
}

function parseOcrLangs(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed as string[];
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_OCR_LANGS;
}

/** Row store for the `ReadingState` table (one per book). */
export class ReadingStateRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findByBookId(bookId: string): ReadingStateEntity | undefined {
    const row = this.db
      .prepare("SELECT * FROM ReadingState WHERE bookId = ?")
      .get(bookId) as
      | (Omit<ReadingStateEntity, "ocrLangs"> & { ocrLangs: string })
      | undefined;
    if (!row) return undefined;
    return { ...row, ocrLangs: parseOcrLangs(row.ocrLangs) };
  }

  /** Inserts a row (with defaults) or updates only the provided columns,
   *  bumping `updatedAt`. Missing fields keep their stored values. */
  upsert(bookId: string, state: ReadingStateInput): void {
    this.db
      .prepare(
        `INSERT INTO ReadingState (
           bookId, currentPage, currentChapter, ocrLangs, sourceLang,
           targetLang, modelId, customPromptId, totalPages, totalChapters,
           progressPercent, updatedAt
         ) VALUES (
           @bookId,
           COALESCE(@currentPage, 1),
           COALESCE(@currentChapter, ''),
           COALESCE(@ocrLangs, '["eng"]'),
           COALESCE(@sourceLang, ''),
           COALESCE(@targetLang, 'English'),
           COALESCE(@modelId, ''),
           COALESCE(@customPromptId, ''),
           COALESCE(@totalPages, 0),
           COALESCE(@totalChapters, 0),
           COALESCE(@progressPercent, 0),
           datetime('now')
         )
         ON CONFLICT(bookId) DO UPDATE SET
           currentPage    = COALESCE(@currentPage,    ReadingState.currentPage),
           currentChapter = COALESCE(@currentChapter, ReadingState.currentChapter),
           ocrLangs       = COALESCE(@ocrLangs,       ReadingState.ocrLangs),
           sourceLang     = COALESCE(@sourceLang,     ReadingState.sourceLang),
           targetLang     = COALESCE(@targetLang,     ReadingState.targetLang),
           modelId        = COALESCE(@modelId,        ReadingState.modelId),
           customPromptId = COALESCE(@customPromptId, ReadingState.customPromptId),
           totalPages     = COALESCE(@totalPages,     ReadingState.totalPages),
           totalChapters  = COALESCE(@totalChapters,  ReadingState.totalChapters),
           progressPercent = COALESCE(@progressPercent, ReadingState.progressPercent),
           updatedAt      = datetime('now')`,
      )
      .run({
        bookId,
        currentPage: state.currentPage ?? null,
        currentChapter: state.currentChapter ?? null,
        ocrLangs: state.ocrLangs !== undefined ? JSON.stringify(state.ocrLangs) : null,
        sourceLang: state.sourceLang ?? null,
        targetLang: state.targetLang ?? null,
        modelId: state.modelId ?? null,
        customPromptId: state.customPromptId ?? null,
        totalPages: state.totalPages ?? null,
        totalChapters: state.totalChapters ?? null,
        progressPercent: state.progressPercent ?? null,
      });
  }

  /** Records that the book was opened, stamping `lastOpenedAt` (used to
   *  order "continue reading"). Creates the row when none exists yet. */
  markOpened(bookId: string): void {
    this.db
      .prepare(
        `INSERT INTO ReadingState (bookId, lastOpenedAt)
         VALUES (?, datetime('now'))
         ON CONFLICT(bookId) DO UPDATE SET lastOpenedAt = excluded.lastOpenedAt`,
      )
      .run(bookId);
  }

  /** Adds elapsed reading seconds to the book's cumulative total (a reading
   *  session is counted from open to close) and to its daily bucket for the
   *  local day the session closed on. Creates rows when none exist yet. */
  addReadingTime(bookId: string, seconds: number): void {
    const day = localDayKey();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO ReadingState (bookId, readingSeconds)
           VALUES (?, ?)
           ON CONFLICT(bookId) DO UPDATE SET
             readingSeconds = ReadingState.readingSeconds + excluded.readingSeconds`,
        )
        .run(bookId, seconds);
      this.db
        .prepare(
          `INSERT INTO ReadingSessions (bookId, day, seconds)
           VALUES (?, ?, ?)
           ON CONFLICT(bookId, day) DO UPDATE SET
             seconds = ReadingSessions.seconds + excluded.seconds`,
        )
        .run(bookId, day, seconds);
    })();
  }

  /** The saved daily reading goal in minutes (the single `ReadingGoals`
   *  row); inserts the default row the first time. */
  getDailyGoal(): number {
    const row = this.db
      .prepare(`SELECT goalMinutes FROM ReadingGoals WHERE id = 1`)
      .get() as { goalMinutes: number } | undefined;
    if (!row) {
      this.db
        .prepare(`INSERT INTO ReadingGoals (id, goalMinutes) VALUES (1, ?)`)
        .run(DEFAULT_GOAL_MINUTES);
      return DEFAULT_GOAL_MINUTES;
    }
    return row.goalMinutes;
  }

  /** Saves the daily reading goal in minutes. */
  setDailyGoal(minutes: number): void {
    this.db
      .prepare(
        `INSERT INTO ReadingGoals (id, goalMinutes) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET goalMinutes = excluded.goalMinutes`,
      )
      .run(Math.max(1, Math.round(minutes)));
  }

  /** Reading time for the last 7 local days (oldest first, zero-filled) plus
   *  today's and the week's totals in seconds. */
  sessionsWeek(): ReadingWeekSummary {
    const now = new Date();
    const days: ReadingDayBucket[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      days.push({ day: localDayKey(date), seconds: 0 });
    }
    const rows = this.db
      .prepare(
        `SELECT day, seconds FROM ReadingSessions
         WHERE day >= ? AND day <= ?
         ORDER BY day`,
      )
      .all(days[0].day, days[days.length - 1].day) as Array<{ day: string; seconds: number }>;
    const byDay = new Map<string, number>();
    for (const row of rows) {
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.seconds);
    }
    let weekSeconds = 0;
    for (const bucket of days) {
      bucket.seconds = byDay.get(bucket.day) ?? 0;
      weekSeconds += bucket.seconds;
    }
    return { days, todaySeconds: days[days.length - 1].seconds, weekSeconds };
  }

  /** Reading-kind books with position data, most recently opened first — the
   *  source for the home "Reading Progress" widget. Books without totals
   *  (never opened, or not reopened since the totals feature landed) are
   *  excluded until their source is read once. */
  listReadingProgress(): ReadingProgressRow[] {
    return this.db
      .prepare(
        `SELECT b.id AS bookId, b.title, rs.currentPage, rs.totalPages,
                rs.currentChapter, rs.totalChapters, rs.progressPercent,
                rs.readingSeconds, rs.lastOpenedAt
         FROM Books b
         JOIN ReadingState rs ON rs.bookId = b.id
         WHERE b.kind = 'reading'
           AND (rs.totalPages > 0 OR rs.totalChapters > 0)
         ORDER BY rs.lastOpenedAt DESC`,
      )
      .all() as ReadingProgressRow[];
  }
}