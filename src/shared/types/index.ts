export type Theme = "light" | "dark";

export type CoverStyle = "forest" | "moss" | "terracotta" | "navy" | "sand" | "moon";

export type BookKind = "created" | "translated" | "reading";

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: CoverStyle;
  /** Rendered instead of the palette gradient when present (data URL). */
  coverImage?: string | null;
  /** Relative path (`covers/<file>`) backing `coverImage`, e.g. for editing. */
  coverPath?: string | null;
  kind?: BookKind;
  progress?: number;
  totalPages?: number;
  pagesRead?: number;
  category?: string;
  /** True when the book is pinned to the top Pinned shelf. */
  isPinned?: boolean;
}

export interface Quote {
  id: string;
  text: string;
  author: string;
  source?: string;
}

export interface WeekStat {
  day: string;
  label: string;
  minutes: number;
  isToday?: boolean;
}
