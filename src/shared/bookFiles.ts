import type { BookSourceType } from "../infrastructure/db/entities/types";

/** File-picker filter shared by the reading/translate dialogs. */
export const BOOK_FILE_FILTERS = [
  { name: "Book file (PDF, EPUB, Markdown)", extensions: ["pdf", "epub", "md", "markdown"] },
];

/** Detects the book source type from a picked file path. Anything that is not
 *  PDF or EPUB is treated as Markdown (covers `.md` and `.markdown`). */
export function detectBookSourceType(filePath: string): BookSourceType {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".epub")) return "epub";
  return "markdown";
}

/** Default book title for a picked file: the file name without its extension
 *  (`/books/my-novel.md` → `my-novel`). The user can still edit it afterwards. */
export function bookTitleFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const withoutExt = base.replace(/\.(pdf|epub|md|markdown)$/i, "");
  return withoutExt.trim();
}

export function bookSourceLabel(sourceType: BookSourceType): string {
  if (sourceType === "pdf") return "PDF document";
  if (sourceType === "epub") return "EPUB book";
  return "Markdown document";
}
