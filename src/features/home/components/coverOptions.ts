export const COVER_OPTIONS = ["forest", "moss", "terracotta", "navy", "sand", "moon"] as const;

export type CoverOption = (typeof COVER_OPTIONS)[number];

export const randomCover = (): CoverOption =>
  COVER_OPTIONS[Math.floor(Math.random() * COVER_OPTIONS.length)];