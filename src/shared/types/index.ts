export type Theme = "light" | "dark";

export type CoverStyle = "forest" | "moss" | "terracotta" | "navy" | "sand" | "moon";

export type BookKind = "created" | "translated" | "reading";

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: CoverStyle;
  kind?: BookKind;
  progress?: number;
  totalPages?: number;
  pagesRead?: number;
  category?: string;
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
