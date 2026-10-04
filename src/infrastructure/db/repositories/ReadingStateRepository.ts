import type Database from "better-sqlite3";
import type { PdfScanRegion, ReadingStateEntity } from "../entities/index.ts";
import { normalizeScanRegion } from "../entities/PdfScanRegion.ts";
import type { ReadingDayBucket, ReadingProgressRow, ReadingWeekSummary } from "../entities/types.ts";
import type { TranslationMethod } from "../entities/Translation.ts";

const DEFAULT_OCR_LANGS = ["eng"];
const DEFAULT_GOAL_MINUTES = 30;
/** Books closed at or above this progress count as finished — content
 *  usually ends before the file's tail (back matter), so an exact 100% is
 *  too strict. */
export const COMPLETION_THRESHOLD = 0.95;

/** Local calendar date as "YYYY-MM-DD" — the key used by the daily reading
 *  buckets. Computed in local time so a day rolls over at midnight for the
 *  user, not at UTC midnight. */
export function localDayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Splits an epoch-millis window into per-local-day second buckets. A session
 *  that crosses local midnight is attributed to both days, each getting the
 *  seconds it actually covered. */
export function splitReadingSeconds(
  startedAt: number,
  endedAt: number,
): Array<{ day: string; seconds: number }> {
  if (endedAt <= startedAt) return [];
  const buckets = new Map<string, number>();
  let cursor = startedAt;
  while (cursor < endedAt) {
    const cursorDate = new Date(cursor);
    const nextMidnight = new Date(
      cursorDate.getFullYear(),
      cursorDate.getMonth(),
      cursorDate.getDate() + 1,
    );
    const segmentEnd = Math.min(endedAt, nextMidnight.getTime());
    const day = localDayKey(cursorDate);
    buckets.set(day, (buckets.get(day) ?? 0) + (segmentEnd - cursor));
    cursor = segmentEnd;
  }
  return [...buckets.entries()].map(([day, millis]) => ({
    day,
    seconds: Math.max(1, Math.round(millis / 1000)),
  }));
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
  /** PDF translation pipeline ("ocr" / "vision"); EPUB books keep "ocr". */
  pdfMethod?: TranslationMethod;
  /** EPUB extraction sent to the AI ("markdown" / "html"); PDF books ignore it. */
  epubExtraction?: "markdown" | "html";
  /** PDF AI-vision figure handling; EPUB books ignore it. */
  pdfAutoFigures?: boolean;
  /** PDF-only: page area that is scanned (OCR) or sent to AI vision, as page
   *  fractions; null / omitted leaves the stored region untouched. */
  pdfScanRegion?: PdfScanRegion | null;
  /** Ordered AI model ids for translation, in failover order (empty = app
   *  default). */
  modelIds?: string[];
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

function parseModelIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed as string[];
    }
  } catch {
    // fall through to empty
  }
  return [];
}

/** Anything unreadable (hand-edited column, truncated write) degrades to "the
 *  whole page" instead of failing the whole reading-state read. */
function parseScanRegion(value: string | null | undefined): PdfScanRegion | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y, w, h } = parsed as Record<string, unknown>;
    if (![x, y, w, h].every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return null;
    }
    return normalizeScanRegion({ x: x as number, y: y as number, w: w as number, h: h as number });
  } catch {
    return null;
  }
}

/** Column payload for a scan region: JSON when there is one, the empty string
 *  (= whole page) when there is not. */
function serializeScanRegion(region: PdfScanRegion | null): string {
  return region ? JSON.stringify(region) : "";
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
      | (Omit<ReadingStateEntity, "ocrLangs" | "modelIds" | "pdfScanRegion"> & {
          ocrLangs: string;
          modelIds: string;
          pdfScanRegion: string;
        })
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      ocrLangs: parseOcrLangs(row.ocrLangs),
      modelIds: parseModelIds(row.modelIds),
      pdfScanRegion: parseScanRegion(row.pdfScanRegion),
    };
  }

  /** Inserts a row (with defaults) or updates only the provided columns,
   *  bumping `updatedAt`. Missing fields keep their stored values. Every
   *  position write also advances `maxProgress` to the highest position
   *  reached — progress never goes down when the user re-reads an earlier
   *  section. */
  upsert(bookId: string, state: ReadingStateInput): void {
    this.db
      .prepare(
`INSERT INTO ReadingState (
           bookId, currentPage, currentChapter, ocrLangs, sourceLang,
           targetLang, modelId, customPromptId, pdfMethod, epubExtraction, pdfAutoFigures, pdfScanRegion, modelIds, totalPages, totalChapters,
           progressPercent, maxProgress, updatedAt
         ) VALUES (
            @bookId,
            COALESCE(@currentPage, 1),
            COALESCE(@currentChapter, ''),
            COALESCE(@ocrLangs, '["eng"]'),
            COALESCE(@sourceLang, ''),
            COALESCE(@targetLang, 'English'),
            COALESCE(@modelId, ''),
            COALESCE(@customPromptId, ''),
            COALESCE(@pdfMethod, 'ocr'),
            COALESCE(@epubExtraction, 'markdown'),
            COALESCE(@pdfAutoFigures, 1),
            COALESCE(@pdfScanRegion, ''),
            COALESCE(@modelIds, '[]'),
            COALESCE(@totalPages, 0),
           COALESCE(@totalChapters, 0),
           COALESCE(@progressPercent, 0),
           CASE WHEN COALESCE(@totalPages, 0) > 0
             THEN CAST(COALESCE(@currentPage, 1) AS REAL) / COALESCE(@totalPages, 0)
             ELSE COALESCE(@progressPercent, 0)
           END,
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
           pdfMethod      = COALESCE(@pdfMethod,      ReadingState.pdfMethod),
           epubExtraction = COALESCE(@epubExtraction, ReadingState.epubExtraction),
           pdfAutoFigures = COALESCE(@pdfAutoFigures, ReadingState.pdfAutoFigures),
            pdfScanRegion  = COALESCE(@pdfScanRegion,  ReadingState.pdfScanRegion),
           modelIds       = COALESCE(@modelIds,       ReadingState.modelIds),
           totalPages     = COALESCE(@totalPages,     ReadingState.totalPages),
           totalChapters  = COALESCE(@totalChapters,  ReadingState.totalChapters),
           progressPercent = COALESCE(@progressPercent, ReadingState.progressPercent),
           maxProgress    = MAX(ReadingState.maxProgress, CASE
             WHEN COALESCE(@totalPages, ReadingState.totalPages) > 0
               THEN CAST(COALESCE(@currentPage, ReadingState.currentPage) AS REAL)
                    / COALESCE(@totalPages, ReadingState.totalPages)
               ELSE COALESCE(@progressPercent, ReadingState.progressPercent)
             END),
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
        pdfMethod: state.pdfMethod ?? null,
        epubExtraction: state.epubExtraction ?? null,
        pdfAutoFigures: state.pdfAutoFigures !== undefined ? (state.pdfAutoFigures ? 1 : 0) : null,
        // `undefined` = not part of this write (keep the stored region); an
        // explicit null = the whole page, stored as a rect that normalizes
        // back to null on read.
        pdfScanRegion:
          state.pdfScanRegion === undefined
            ? null
            : serializeScanRegion(normalizeScanRegion(state.pdfScanRegion)),
        modelIds: state.modelIds !== undefined ? JSON.stringify(state.modelIds) : null,
        totalPages: state.totalPages ?? null,
        totalChapters: state.totalChapters ?? null,
        progressPercent: state.progressPercent ?? null,
      });
  }

  /** Records that the book was opened, stamping `lastOpenedAt` (used to
   *  order "continue reading"). Creates the row when none exists yet.
   *  Reopening a finished book brings it back to the reading-progress
   *  list (the finish state is only set when the book is closed again). */
  markOpened(bookId: string): void {
    this.db
      .prepare(
        `INSERT INTO ReadingState (bookId, lastOpenedAt, finished)
         VALUES (?, datetime('now'), 0)
         ON CONFLICT(bookId) DO UPDATE SET
           lastOpenedAt = excluded.lastOpenedAt,
           finished     = 0`,
      )
      .run(bookId);
  }

  /** Marks the book finished when it was closed at or above
   *  `COMPLETION_THRESHOLD` (its content has effectively ended — the tail
   *  of the file is usually back matter nobody reads). Runs on session
   *  close; `markOpened` clears the flag again. */
  finalizeReadingState(bookId: string): void {
    this.db
      .prepare(
        `UPDATE ReadingState SET
           finished  = CASE WHEN maxProgress >= ? THEN 1 ELSE 0 END,
           updatedAt = datetime('now')
         WHERE bookId = ?`,
      )
      .run(COMPLETION_THRESHOLD, bookId);
  }

  /** Appends one actually-counted reading segment to the event ledger — the
   *  single source of truth for reading time. Daily totals are computed from
   *  these rows on read (`sessionsWeek`), so nothing else is written here. */
  appendReadingEvent(bookId: string, startedAt: number, endedAt: number): void {
    if (endedAt <= startedAt) return;
    const totalSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
    this.db
      .prepare(
        `INSERT INTO ReadingEvents (bookId, startedAt, endedAt, seconds)
         VALUES (?, ?, ?, ?)`,
      )
      .run(bookId, startedAt, endedAt, totalSeconds);
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
   *  today's and the week's totals in seconds — computed by splitting every
   *  ledger segment that ends inside the window across the local days it
   *  covers (a segment crossing local midnight is attributed to both days). */
  sessionsWeek(): ReadingWeekSummary {
    const now = new Date();
    const days: ReadingDayBucket[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      days.push({ day: localDayKey(date), seconds: 0 });
    }
    const windowStartMs = new Date(`${days[0].day}T00:00:00`).getTime();
    const rows = this.db
      .prepare(
        `SELECT startedAt, endedAt FROM ReadingEvents
         WHERE endedAt >= ?
         ORDER BY startedAt`,
      )
      .all(windowStartMs) as Array<{ startedAt: number; endedAt: number }>;
    const byDay = new Map<string, number>();
    for (const row of rows) {
      for (const bucket of splitReadingSeconds(row.startedAt, row.endedAt)) {
        byDay.set(bucket.day, (byDay.get(bucket.day) ?? 0) + bucket.seconds);
      }
    }
    let weekSeconds = 0;
    for (const bucket of days) {
      bucket.seconds = byDay.get(bucket.day) ?? 0;
      weekSeconds += bucket.seconds;
    }
    return { days, todaySeconds: days[days.length - 1].seconds, weekSeconds };
  }

  /** Reading-kind books still in progress (finished ones drop out), most
   *  recently opened first — the source for the home "Reading Progress"
   *  widget, which shows the four most recently studied books. Books
   *  without totals (never opened, or not reopened since the totals feature
   *  landed) are excluded until their source is read once. */
  listReadingProgress(): ReadingProgressRow[] {
    return this.db
      .prepare(
        `SELECT b.id AS bookId, b.title, rs.currentPage, rs.totalPages,
                rs.currentChapter, rs.totalChapters, rs.progressPercent,
                rs.maxProgress, rs.lastOpenedAt
         FROM Books b
         JOIN ReadingState rs ON rs.bookId = b.id
         WHERE b.kind = 'reading'
           AND (rs.totalPages > 0 OR rs.totalChapters > 0)
           AND rs.finished = 0
         ORDER BY rs.lastOpenedAt DESC`,
      )
      .all() as ReadingProgressRow[];
  }
}