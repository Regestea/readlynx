import type Database from "better-sqlite3";
import type { ReadingStateEntity } from "../entities/index.ts";

const DEFAULT_OCR_LANGS = ["eng"];

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
           targetLang, modelId, customPromptId, updatedAt
         ) VALUES (
           @bookId,
           COALESCE(@currentPage, 1),
           COALESCE(@currentChapter, ''),
           COALESCE(@ocrLangs, '["eng"]'),
           COALESCE(@sourceLang, ''),
           COALESCE(@targetLang, 'English'),
           COALESCE(@modelId, ''),
           COALESCE(@customPromptId, ''),
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
}