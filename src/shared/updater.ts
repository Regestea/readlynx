/** Wire format of the self-update feature.
 *
 * Lives in `shared/` because both TypeScript projects compile it: the main
 * process (`electron/updater.ts`) produces these values and the renderer
 * consumes them over IPC — the same trick the db layer uses for its entities.
 */

/** One downloadable build attached to a GitHub release. */
export interface UpdateAsset {
  name: string;
  /** `browser_download_url` of the asset. */
  url: string;
  /** Byte size GitHub reports for the asset. */
  size: number;
  /** Lowercase hex sha256, or `null` when the release publishes no checksum.
   *  A download with no checksum is still installed, just unverified. */
  sha256: string | null;
}

/** Answer to "is there anything newer than what is running?". */
export interface UpdateCheckResult {
  /** True in an unpackaged dev run, where the placeholder `0.0.0` version in
   *  package.json would make every release look newer. */
  disabled: boolean;
  currentVersion: string;
  /** Newest published tag, even when it is not newer than the running build. */
  latestVersion: string;
  updateAvailable: boolean;
  /** Release body (Markdown) as written by the release job. */
  notes: string;
  /** Web page of the release, used by the "download manually" fallback. */
  releaseUrl: string;
  publishedAt: string | null;
  /** Build matching this OS and CPU, or null when the release ships none. */
  asset: UpdateAsset | null;
  /** Human label for this build's platform, e.g. "macOS (Apple Silicon)". */
  platform: string;
}

/** Long-running step of the install pipeline, mirrored to the renderer. */
export type UpdatePhase = "downloading" | "verifying" | "installing";

export interface UpdateProgress {
  phase: UpdatePhase;
  received: number;
  total: number;
  /** 0..1, or null while the total size is unknown. */
  fraction: number | null;
  /** Average speed since the download started. */
  bytesPerSecond: number;
  /** Seconds left, or null while the total size is unknown. */
  etaSeconds: number | null;
}

export interface UpdateInstallResult {
  ok: boolean;
  /** True once the app is on its way out — it quits, or has already handed the
   *  file to the OS — so the renderer must not expect more events. */
  restarting: boolean;
  /** What happens next, shown in the dialog once the download is done. */
  message: string;
  error?: string;
}