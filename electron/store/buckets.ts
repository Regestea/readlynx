import path from "node:path";

export type BucketName = "covers" | "books" | "ocr" | "exports" | "temp" | "translation-images";

export interface BucketConfig {
  /** Allowed file extensions (without dot). Empty array = no restriction. */
  allowedExtensions: string[];
}

export const BUCKETS: Record<BucketName, BucketConfig> = {
  covers: {
    allowedExtensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif"],
  },
  books: {
    allowedExtensions: ["pdf", "epub"],
  },
  ocr: {
    allowedExtensions: ["gz"],
  },
  exports: {
    allowedExtensions: ["pdf", "docx", "html", "md", "epub", "txt"],
  },
  temp: {
    allowedExtensions: [],
  },
  "translation-images": {
    allowedExtensions: ["png", "jpg", "jpeg", "webp", "svg"],
  },
};

export function bucketDir(storeRoot: string, bucket: BucketName): string {
  return path.join(storeRoot, bucket);
}

export function isAllowedExtension(bucket: BucketName, ext: string): boolean {
  const config = BUCKETS[bucket];
  if (config.allowedExtensions.length === 0) return true;
  return config.allowedExtensions.includes(ext.toLowerCase());
}
