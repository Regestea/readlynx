import type { Book, Quote, WeekStat } from "../../../shared/types";

export const continueReadingBooks: Book[] = [
  {
    id: "b1",
    title: "The Hidden Life of Trees",
    author: "Peter Wohlleben",
    cover: "forest",
    progress: 0.68,
    totalPages: 288,
    pagesRead: 196,
    category: "Nature",
  },
  {
    id: "b2",
    title: "Atomic Habits",
    author: "James Clear",
    cover: "terracotta",
    progress: 0.42,
    totalPages: 320,
    pagesRead: 134,
    category: "Self Growth",
  },
  {
    id: "b3",
    title: "Braiding Sweetgrass",
    author: "Robin Wall Kimmerer",
    cover: "moon",
    progress: 0.53,
    totalPages: 391,
    pagesRead: 207,
    category: "Nature",
  },
  {
    id: "b4",
    title: "The Overstory",
    author: "Richard Powers",
    cover: "navy",
    progress: 0.27,
    totalPages: 512,
    pagesRead: 138,
    category: "Fiction",
  },
];

export const recommendedBooks: Book[] = [
  { id: "r1", title: "Where the Crawdads Sing", author: "Delia Owens", cover: "moss", category: "Fiction" },
  { id: "r2", title: "The Overstory", author: "Richard Powers", cover: "navy", category: "Fiction" },
  { id: "r3", title: "Meditations", author: "Marcus Aurelius", cover: "sand", category: "Philosophy" },
  { id: "r4", title: "Sapiens", author: "Yuval Noah Harari", cover: "terracotta", category: "History" },
  { id: "r5", title: "The Song of Achilles", author: "Madeline Miller", cover: "forest", category: "Fiction" },
  { id: "r6", title: "Dune", author: "Frank Herbert", cover: "navy", category: "Sci-Fi" },
];

export const weeklyProgressBooks: Book[] = [
  { id: "p1", title: "The Hidden Life of Trees", author: "Peter Wohlleben", cover: "forest", progress: 0.68 },
  { id: "p2", title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", cover: "moon", progress: 0.53 },
  { id: "p3", title: "Where the Crawdads Sing", author: "Delia Owens", cover: "moss", progress: 0.24 },
];

export const createdBooks: Book[] = [
  { id: "c1", title: "Mountain Winds", author: "Avery Lane", cover: "forest", progress: 0.35, category: "Draft" },
  { id: "c2", title: "Seasons of Tea", author: "Avery Lane", cover: "terracotta", progress: 0.62, category: "Draft" },
  { id: "c3", title: "Quiet Compass", author: "Avery Lane", cover: "moon", progress: 0.18, category: "Draft" },
  { id: "c4", title: "Letters from Home", author: "Avery Lane", cover: "sand", progress: 0.84, category: "Draft" },
];

export const translatedBooks: Book[] = [
  { id: "t1", title: "The Little Prince", author: "Antoine de Saint-Exupéry", cover: "navy", progress: 0.7, category: "Translation" },
  { id: "t2", title: "The Alchemist", author: "Paulo Coelho", cover: "moss", progress: 0.45, category: "Translation" },
  { id: "t3", title: "Siddhartha", author: "Hermann Hesse", cover: "sand", progress: 0.9, category: "Translation" },
  { id: "t4", title: "Persian Miniatures", author: "Anthony Welch", cover: "terracotta", progress: 0.28, category: "Translation" },
];

export const overallProgress = 0.64;
export const overallPages = 320;

export const dailyQuote: Quote = {
  id: "q1",
  text: "We read to know we are not alone.",
  author: "C.S. Lewis",
  source: "The Four Loves",
};

export const weekStats: WeekStat[] = [
  { day: "mon", label: "M", minutes: 35 },
  { day: "tue", label: "T", minutes: 60 },
  { day: "wed", label: "W", minutes: 45 },
  { day: "thu", label: "T", minutes: 90 },
  { day: "fri", label: "F", minutes: 50 },
  { day: "sat", label: "S", minutes: 120, isToday: true },
  { day: "sun", label: "S", minutes: 80 },
];
