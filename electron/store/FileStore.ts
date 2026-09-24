import fs from "node:fs";
import path from "node:path";
import { BUCKETS, type BucketName, bucketDir, isAllowedExtension } from "./buckets.ts";

export interface FileMeta {
  size: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
}

interface ManifestEntry {
  size: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
}

type Manifest = Record<string, ManifestEntry>;

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  pdf: "application/pdf",
  epub: "application/epub+zip",
  gz: "application/gzip",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function guessContentType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Lightweight S3-like file store for the desktop app.
 *
 * Organizes files into named buckets (covers, books, ocr, exports, temp).
 * Each file is identified by a `key` within its bucket, e.g. `"covers/abc123.png"`.
 *
 * Provides: put, get, delete, exists, list, stat, resolve.
 * Maintains a JSON manifest with content-type, size, and timestamps.
 */
export class FileStore {
  private readonly root: string;
  private manifest: Manifest = {};
  private manifestPath: string;

  constructor(storeRoot: string) {
    this.root = path.resolve(storeRoot);
    this.manifestPath = path.join(this.root, "manifest.json");
  }

  /** Creates all bucket directories and loads the manifest. Missing entries
   *  (e.g. after upgrading from the legacy bare-key manifest) are rebuilt
   *  from disk so `stat`/`list` keep working. */
  init(): void {
    fs.mkdirSync(this.root, { recursive: true });
    for (const bucket of Object.keys(BUCKETS) as BucketName[]) {
      fs.mkdirSync(bucketDir(this.root, bucket), { recursive: true });
    }
    this.loadManifest();
    this.reconcileManifestWithDisk();
  }

  /** Adds manifest entries for files that exist on disk but are untracked
   *  (legacy installs, manual copies) and drops orphans. Preserves
   *  `createdAt` for already-tracked files. */
  private reconcileManifestWithDisk(): void {
    let dirty = false;
    for (const bucket of Object.keys(BUCKETS) as BucketName[]) {
      const entries = this.scanDir(bucket, bucketDir(this.root, bucket));
      const prefix = `${bucket}/`;
      for (const key of Object.keys(this.manifest)) {
        if (key.startsWith(prefix) && !entries[key]) {
          try {
            if (!fs.existsSync(path.join(this.root, ...key.split("/")))) {
              delete this.manifest[key];
              dirty = true;
            }
          } catch {
            // keep the entry on unexpected errors
          }
        }
      }
      for (const [key, meta] of Object.entries(entries)) {
        if (!this.manifest[key]) {
          this.manifest[key] = meta;
          dirty = true;
        }
      }
    }
    if (dirty) this.saveManifest();
  }

  // ── Core API ──────────────────────────────────────────────────────

  /** Stores data under `bucket/key`. Overwrites any existing file.
   *  Returns the bucket-relative key (e.g. `"covers/abc.png"`).
   *  Manifest keys are always stored fully qualified (`"bucket/rel"`). */
  put(bucket: BucketName, key: string, data: Buffer | Uint8Array): string {
    this.assertValidKey(key);
    const ext = path.extname(key).slice(1).toLowerCase();
    if (!isAllowedExtension(bucket, ext)) {
      throw new Error(`Extension ".${ext}" is not allowed in bucket "${bucket}"`);
    }
    const full = this.resolvePath(bucket, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    const now = new Date().toISOString();
    const fullKey = this.fullKey(bucket, key);
    const existing = this.manifest[fullKey];
    this.manifest[fullKey] = {
      size: data.byteLength,
      contentType: guessContentType(ext),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.saveManifest();
    return key;
  }

  /** Reads the file at `bucket/key`. Returns null if not found. */
  get(bucket: BucketName, key: string): Buffer | null {
    this.assertValidKey(key);
    const full = this.resolvePath(bucket, key);
    try {
      return fs.readFileSync(full);
    } catch {
      return null;
    }
  }

  /** Reads the file and returns it as a base64 data URL. Returns null if not found. */
  getDataUrl(bucket: BucketName, key: string): string | null {
    const meta = this.manifest[this.fullKey(bucket, key)];
    const buf = this.get(bucket, key);
    if (!buf || !meta) return null;
    return `data:${meta.contentType};base64,${buf.toString("base64")}`;
  }

  /** Deletes the file at `bucket/key`. No-op if the file does not exist. */
  delete(bucket: BucketName, key: string): void {
    this.assertValidKey(key);
    const full = this.resolvePath(bucket, key);
    try {
      fs.unlinkSync(full);
    } catch {
      // already gone
    }
    const fullKey = this.fullKey(bucket, key);
    if (this.manifest[fullKey]) {
      delete this.manifest[fullKey];
      this.saveManifest();
    }
  }

  /** Returns true if the file exists on disk. */
  exists(bucket: BucketName, key: string): boolean {
    this.assertValidKey(key);
    const full = this.resolvePath(bucket, key);
    try {
      fs.accessSync(full, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Lists files in a bucket, optionally filtered by key prefix.
   *  Returns an array of `{ key, ...meta }` sorted by key. */
  list(bucket: BucketName, prefix?: string): Array<{ key: string } & FileMeta> {
    const bucketPrefix = prefix ? `${prefix}` : "";
    return Object.entries(this.manifest)
      .filter(([key]) => {
        if (!key.startsWith(`${bucket}/`)) return false;
        if (bucketPrefix && !key.slice(bucket.length + 1).startsWith(bucketPrefix))
          return false;
        return true;
      })
      .map(([key, meta]) => ({ key, ...meta }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Returns metadata for a single file, or null if not tracked. */
  stat(bucket: BucketName, key: string): FileMeta | null {
    const meta = this.manifest[this.fullKey(bucket, key)];
    if (!meta) return null;
    return { ...meta };
  }

  /** Returns the absolute file path for a stored key.
   *  Returns null if the key is invalid or the bucket does not exist. */
  resolve(key: string): string | null {
    const parts = key.split("/");
    if (parts.length < 2) return null;
    const bucket = parts[0] as BucketName;
    if (!BUCKETS[bucket]) return null;
    const fileKey = parts.slice(1).join("/");
    const full = this.resolvePath(bucket, fileKey);
    if (!fs.existsSync(full)) return null;
    return full;
  }

  /** Raw readdir of a bucket directory (for backup/restore). */
  readDir(bucket: BucketName): string[] {
    const dir = bucketDir(this.root, bucket);
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  }

  /** Writes raw bytes directly to a bucket file (for restore operations). */
  putRaw(bucket: BucketName, fileName: string, data: Buffer | Uint8Array): void {
    const dir = bucketDir(this.root, bucket);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), data);
  }

  /** Deletes an entire bucket directory and recreates it empty. */
  clearBucket(bucket: BucketName): void {
    const dir = bucketDir(this.root, bucket);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // Remove manifest entries for this bucket
    for (const key of Object.keys(this.manifest)) {
      if (key.startsWith(`${bucket}/`)) delete this.manifest[key];
    }
    this.saveManifest();
  }

  /** Copies a bucket directory to a destination path (for backup). */
  copyBucketTo(bucket: BucketName, dest: string): void {
    const dir = bucketDir(this.root, bucket);
    if (!fs.existsSync(dir)) return;
    fs.cpSync(dir, dest, { recursive: true });
  }

  /** Copies files from a source directory into a bucket (for restore). */
  copyToBucket(bucket: BucketName, src: string): void {
    const dir = bucketDir(this.root, bucket);
    fs.cpSync(src, dir, { recursive: true });
    // Rebuild manifest entries for this bucket from disk
    this.rebuildBucketManifest(bucket);
  }

  // ── Path helpers ──────────────────────────────────────────────────

  /** Absolute path of the store root. */
  get rootPath(): string {
    return this.root;
  }

  private resolvePath(bucket: BucketName, key: string): string {
    return path.join(this.root, bucket, key);
  }

  /** Fully qualified manifest key (`"bucket/rel"`). */
  private fullKey(bucket: BucketName, key: string): string {
    return `${bucket}/${key}`;
  }

  private assertValidKey(key: string): void {
    if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
      throw new Error(`Invalid store key: "${key}"`);
    }
  }

  // ── Manifest ──────────────────────────────────────────────────────

  private loadManifest(): void {
    try {
      const raw = fs.readFileSync(this.manifestPath, "utf8");
      const parsed = JSON.parse(raw) as Manifest;
      this.manifest = this.migrateLegacyManifest(parsed);
      // Persist the migration straight away so old bare keys disappear.
      if (this.manifest !== parsed) this.saveManifest();
    } catch {
      this.manifest = {};
    }
  }

  /** Older versions stored bare keys (`"uuid.png"`) instead of qualified
   *  `"bucket/rel"` keys, which broke `list()`/`clearBucket()` and caused
   *  cross-bucket collisions. Bare keys cannot be attributed reliably, so
   *  drop them here — `init()` rebuilds them from disk below. */
  private migrateLegacyManifest(parsed: Manifest): Manifest {
    if (!parsed || typeof parsed !== "object") return {};
    const needsMigration = Object.keys(parsed).some((key) => !key.includes("/"));
    if (!needsMigration) return parsed;
    const kept: Manifest = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.includes("/")) kept[key] = value;
    }
    return kept;
  }

  private saveManifest(): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), "utf8");
  }

  /** Rebuilds manifest entries for a bucket by scanning disk. Used after
   *  raw restore operations that bypass the normal put() flow. Overwrites
   *  stale entries and drops orphan entries for files that no longer exist. */
  private rebuildBucketManifest(bucket: BucketName): void {
    const dir = bucketDir(this.root, bucket);
    const entries = this.scanDir(bucket, dir);
    const prefix = `${bucket}/`;
    for (const key of Object.keys(this.manifest)) {
      if (key.startsWith(prefix) && !entries[key]) delete this.manifest[key];
    }
    for (const [key, meta] of Object.entries(entries)) {
      const existing = this.manifest[key];
      this.manifest[key] = {
        ...meta,
        createdAt: existing?.createdAt ?? meta.createdAt,
      };
    }
    this.saveManifest();
  }

  private scanDir(bucket: BucketName, dir: string, prefix = ""): Manifest {
    const result: Manifest = {};
    let items: string[];
    try {
      items = fs.readdirSync(dir);
    } catch {
      return result;
    }
    for (const item of items) {
      const full = path.join(dir, item);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isFile()) {
        const rel = prefix ? `${prefix}/${item}` : item;
        const ext = path.extname(item).slice(1).toLowerCase();
        result[`${bucket}/${rel}`] = {
          size: stat.size,
          contentType: guessContentType(ext),
          createdAt: stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
        };
      } else if (stat.isDirectory()) {
        const subPrefix = prefix ? `${prefix}/${item}` : item;
        Object.assign(result, this.scanDir(bucket, full, subPrefix));
      }
    }
    return result;
  }
}
