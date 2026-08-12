import type Database from "better-sqlite3";
import type { ReadingStateEntity } from "../entities/index.ts";

const DEFAULT_OCR_LANGS = ["eng"];

/** Settings a book keeps between reading sessions. */
export interface ReadingStateInput {
  currentPage: number;
  scrollPosition: number;
  ocrLangs: string[];
  sourceLang: string;
  targetLang: string;
  customPrompt: string;
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

  /** Inserts or fully replaces the reading state row, bumping `updatedAt`. */
  upsert(bookId: string, state: ReadingStateInput): void {
    this.db
      .prepare(
        `INSERT INTO ReadingState (
           bookId, currentPage, scrollPosition, ocrLangs, sourceLang,
           targetLang, customPrompt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(bookId) DO UPDATE SET
           currentPage    = excluded.currentPage,
           scrollPosition = excluded.scrollPosition,
           ocrLangs       = excluded.ocrLangs,
           sourceLang     = excluded.sourceLang,
           targetLang     = excluded.targetLang,
           customPrompt   = excluded.customPrompt,
           updatedAt      = excluded.updatedAt`,
      )
      .run(
        bookId,
        state.currentPage,
        state.scrollPosition,
        JSON.stringify(state.ocrLangs),
        state.sourceLang,
        state.targetLang,
        state.customPrompt,
      );
  }
}