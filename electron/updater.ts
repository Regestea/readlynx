import { app, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchWithLog } from "./httpLog.ts";
import type {
  UpdateAsset,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateProgress,
} from "../src/shared/updater.ts";

/** GitHub repository the installers are published to. */
const OWNER = "Regestea";
const REPO = "readlynx";
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`;

/** GitHub rejects API requests without one, and an unset UA is the single
 *  most common reason for a puzzling 403. */
const USER_AGENT = "ReadLynx-Updater";

/** Chunk counts would otherwise repaint the progress bar hundreds of times a
 *  second, so progress is only reported on this interval. */
const PROGRESS_INTERVAL_MS = 300;

/** Grace period between handing the update to the OS and quitting, so the IPC
 *  reply (which shows the "restarting" message) still reaches the renderer. */
const QUIT_DELAY_MS = 600;

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  /** `"sha256:<hex>"` since GitHub started hashing uploads; null on older
   *  releases, where `SHA256SUMS.txt` is the fallback. */
  digest?: string | null;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string | null;
  assets: GithubAsset[];
}

/** Newest release looked up by the last check, reused by `installUpdate` so the
 *  download target is decided in the main process and never by the renderer. */
let checked: UpdateCheckResult | null = null;

/** Aborts the in-flight download, if any (the "Cancel" button in the dialog). */
let activeDownload: AbortController | null = null;

/* -------------------------------------------------------------------------- */
/* Version comparison                                                          */
/* -------------------------------------------------------------------------- */

/** `v0.1.5` → `0.1.5`. */
function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

/** Splits a version into its numeric parts, ignoring any pre-release suffix:
 * releases are published as plain patch bumps, so `0.1.6-beta.1` only ever has
 * to sort against `0.1.5`. */
function versionParts(raw: string): number[] {
  return normalizeVersion(raw)
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

/** True when `candidate` is a strictly newer version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Release lookup                                                              */
/* -------------------------------------------------------------------------- */

function describePlatform(): string {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "macOS (Apple Silicon)" : "macOS (Intel)";
  }
  if (process.platform === "linux") return "Linux";
  return process.platform;
}

/** Picks the release build that runs on this OS and CPU.
 *
 * electron-builder names the artifacts after the product, the version and the
 * architecture, but the exact spelling drifts between targets and versions
 * (`ReadLynx Setup 0.1.2.exe`, `ReadLynx-0.1.2-arm64.dmg`, `ReadLynx-0.1.2.dmg`,
 * `ReadLynx-0.1.2-arm64-mac.zip`, `ReadLynx-0.1.2.AppImage`,
 * `readlynx_0.1.2_amd64.deb`). The exact names are tried first so a release
 * carrying both an arm64 and an Intel build can never hand over the wrong one;
 * the extension fallbacks only ever accept a file this machine could run. */
export function pickAsset(assets: UpdateAsset[], version: string): UpdateAsset | null {
  const exact = (...names: string[]): UpdateAsset | null => {
    for (const name of names) {
      const found = assets.find((asset) => asset.name === name);
      if (found) return found;
    }
    return null;
  };
  const byPattern = (...patterns: RegExp[]): UpdateAsset | null => {
    for (const pattern of patterns) {
      const found = assets.find((asset) => pattern.test(asset.name));
      if (found) return found;
    }
    return null;
  };

  if (process.platform === "win32") {
    return (
      exact(`ReadLynx Setup ${version}.exe`, `ReadLynx.Setup.${version}.exe`) ??
      byPattern(/\.exe$/i)
    );
  }

  if (process.platform === "darwin") {
    const arm64 = process.arch === "arm64";
    const arch = arm64 ? "arm64" : "x64";
    return (
      exact(
        `ReadLynx-${version}-${arch}.dmg`,
        `ReadLynx-${version}.dmg`,
        `ReadLynx-${version}-universal.dmg`,
        `ReadLynx-${version}-${arch}-mac.zip`,
        `ReadLynx-${version}-mac.zip`,
      ) ??
      // Fall back on the extension, keeping architectures apart: an Intel
      // build must never be handed to an Apple Silicon machine (or the
      // reverse), and a name carrying no architecture tag is the universal one.
      byPattern(
        arm64 ? /arm64.*\.dmg$/i : /^(?!.*(arm64|arm|aarch)).*\.dmg$/i,
        arm64 ? /arm64.*\.zip$/i : /^(?!.*(arm64|arm|aarch)).*\.zip$/i,
      )
    );
  }

  // The AppImage is preferred: replacing it needs no root and no package
  // manager, while the .deb can only be handed to the user to install.
  return (
    exact(`ReadLynx-${version}.AppImage`) ??
    byPattern(/\.AppImage$/i) ??
    exact(`readlynx_${version}_amd64.deb`) ??
    byPattern(/\.deb$/i)
  );
}

/** GitHub rewrites spaces in an uploaded file name to dots and keeps the
 *  original only as the asset's label (`ReadLynx Setup 0.1.2.exe` is stored as
 *  `ReadLynx.Setup.0.1.2.exe`), while `SHA256SUMS.txt` holds whatever the build
 *  actually produced. Comparing the two therefore only works once every
 *  separator is dropped. */
function looseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Reads the digest `sha256sum` recorded for one file. Lines read
 *  `<hex>  <file>` (two spaces, one more in binary mode) and a file name may
 *  itself contain spaces, so everything after the hash is the name. */
function sumEntryFor(text: string, name: string): string | null {
  const wanted = looseName(name);
  for (const entry of text.split(/\r?\n/)) {
    const parts = entry.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const file = parts.slice(1).join(" ").replace(/^\*/, "").trim();
    if (looseName(file) !== wanted) continue;
    const hex = parts[0].toLowerCase();
    return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  }
  return null;
}

/** GitHub only started filling `digest` on uploaded assets in 2025; older
 *  releases are covered by the `SHA256SUMS.txt` the release job writes next to
 *  the installers. Returns null when neither source has a digest.
 *
 *  Plain `fetch` on purpose: this and the release lookup are small internal
 *  calls, and `fetchWithLog` would mirror the whole release payload (hundreds
 *  of KB of JSON) into the DevTools console of every window. */
async function resolveChecksum(assets: UpdateAsset[], name: string): Promise<string | null> {
  const sums = assets.find((asset) => asset.name === "SHA256SUMS.txt");
  if (!sums) return null;
  try {
    const response = await fetch(sums.url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;
    return sumEntryFor(await response.text(), name);
  } catch (error) {
    console.log(`[updater] could not read ${sums.name}:`, error);
    return null;
  }
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const response = await fetch(`${API_ROOT}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) throw new Error("No release has been published yet.");
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub's rate limit was reached. Try again in a few minutes.");
  }
  if (!response.ok) throw new Error(`GitHub answered with status ${response.status}.`);
  return (await response.json()) as GithubRelease;
}

/** Asks GitHub for the newest release and works out whether it is worth
 *  offering to this machine. Never throws for the "nothing newer" case — that
 *  is simply `updateAvailable: false`. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  // A dev run carries the placeholder `0.0.0`, which every release beats.
  if (!app.isPackaged) {
    checked = {
      disabled: true,
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      notes: "",
      releaseUrl: RELEASES_PAGE,
      publishedAt: null,
      asset: null,
      platform: describePlatform(),
    };
    return checked;
  }

  const release = await fetchLatestRelease();
  const assets: UpdateAsset[] = release.assets.map((asset) => ({
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: asset.digest?.startsWith("sha256:")
      ? asset.digest.slice("sha256:".length).toLowerCase()
      : null,
  }));
  const latestVersion = normalizeVersion(release.tag_name);
  const updateAvailable = isNewerVersion(latestVersion, currentVersion);
  const asset = updateAvailable ? pickAsset(assets, latestVersion) : null;
  if (asset && !asset.sha256) {
    asset.sha256 = await resolveChecksum(assets, asset.name);
  }
  console.log(
    `[updater] ${currentVersion} -> ${latestVersion} (${updateAvailable ? "newer" : "up to date"})` +
      ` for ${describePlatform()}: ${asset ? asset.name : "no matching build"}`,
  );

  checked = {
    disabled: false,
    currentVersion,
    latestVersion,
    updateAvailable,
    notes: release.body ?? "",
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    asset,
    platform: describePlatform(),
  };
  return checked;
}

/** The last check, running one first when the app has not asked yet. */
export async function latestChecked(): Promise<UpdateCheckResult> {
  return checked ?? checkForUpdates();
}

/** The release page of the last check, for the "download manually" fallback. */
export function releasesPage(): string {
  return checked?.releaseUrl ?? RELEASES_PAGE;
}

/** Opens a release-notes link in the system browser.
 *
 * Release notes are remote content, so a link inside them is only ever allowed
 * to reach github.com over https — never a `file:` or custom-scheme URL. */
export async function openExternalLink(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== "github.com" && !url.hostname.endsWith(".github.com")) return false;
  await shell.openExternal(url.toString());
  return true;
}

/* -------------------------------------------------------------------------- */
/* Download                                                                    */
/* -------------------------------------------------------------------------- */

function throttleProgress(): { shouldEmit: () => boolean } {
  let last = 0;
  return {
    shouldEmit: () => {
      const now = Date.now();
      if (now - last < PROGRESS_INTERVAL_MS) return false;
      last = now;
      return true;
    },
  };
}

/** Streams the asset to a temp file, reporting progress as it goes.
 *
 * The download is written in chunks straight to disk instead of being buffered
 * in memory: the installers are ~200 MB. An aborted download leaves a partial
 * file behind, which the next run deletes before starting. */
export async function downloadAsset(
  asset: UpdateAsset,
  onProgress: (progress: UpdateProgress) => void,
): Promise<string> {
  const directory = path.join(app.getPath("temp"), "readlynx-updates");
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, asset.name);
  await fs.rm(filePath, { force: true });

  const controller = new AbortController();
  activeDownload = controller;

  try {
    try {
      const response = await fetchWithLog(asset.url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`The download failed with status ${response.status}.`);
      }
      const total = Number(response.headers.get("content-length")) || asset.size;

      const startedAt = Date.now();
      const throttle = throttleProgress();
      let received = 0;
      const report = (force: boolean) => {
        if (!force && !throttle.shouldEmit()) return;
        // The average speed since the start is used instead of a per-window one:
        // the first chunks arrive milliseconds apart and would read as an absurd
        // rate, which makes the ETA jump around on slower connections.
        const seconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
        const bytesPerSecond = Math.round(received / seconds);
        const remaining = total > 0 ? total - received : 0;
        onProgress({
          phase: "downloading",
          received,
          total,
          fraction: total > 0 ? Math.min(1, received / total) : null,
          bytesPerSecond,
          etaSeconds:
            bytesPerSecond > 0 && remaining > 0 ? Math.round(remaining / bytesPerSecond) : null,
        });
      };

      const handle = await fs.open(filePath, "w");
      try {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await handle.write(value);
          received += value.byteLength;
          report(false);
        }
      } finally {
        await handle.close();
      }
      report(true);
      return filePath;
    } catch (error) {
      // Aborting surfaces as an opaque "This operation was aborted" from the
      // HTTP stack; the user pressed Cancel, so say that instead. The partial
      // file goes too — leaving it would only be deleted on the next run.
      if (controller.signal.aborted) {
        await fs.rm(filePath, { force: true });
        throw new Error("The download was cancelled.", { cause: error });
      }
      throw error;
    }
  } finally {
    activeDownload = null;
  }
}

/** Stops the running download; resolves once the fetch has actually unwound. */
export function cancelDownload(): void {
  activeDownload?.abort();
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/** Confirms the bytes on disk are the bytes the release published.
 *
 *  Returns a failure result to abort on (and the bad file is deleted), or null
 *  to carry on. A release that publishes no checksum is logged and installed
 *  anyway: refusing outright would strand anyone whose release predates the
 *  checksums. */
async function verifyChecksum(
  asset: UpdateAsset,
  filePath: string,
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateInstallResult | null> {
  onProgress({
    phase: "verifying",
    received: 0,
    total: 0,
    fraction: null,
    bytesPerSecond: 0,
    etaSeconds: null,
  });
  if (!asset.sha256) {
    console.log("[updater] the release publishes no checksum; installing unverified");
    return null;
  }
  const actual = await sha256File(filePath);
  if (actual !== asset.sha256) {
    await fs.rm(filePath, { force: true });
    return {
      ok: false,
      restarting: false,
      message: "",
      error: "The downloaded file did not match the published checksum and was deleted.",
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Install                                                                     */
/* -------------------------------------------------------------------------- */

/** Quits a moment after the install handoff, so the renderer can show what is
 *  about to happen before the window goes away. */
function scheduleQuit(): void {
  setTimeout(() => app.quit(), QUIT_DELAY_MS);
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${String(code)}.`));
    });
  });
}

/** Windows: the asset is the NSIS installer, so spawning it detached hands the
 *  whole job to the OS. The app quits right after so the installer can replace
 *  the running files without a second "app is running" prompt. */
function installOnWindows(filePath: string): UpdateInstallResult {
  const child = spawn(filePath, [], { detached: true, stdio: "ignore" });
  child.unref();
  scheduleQuit();
  return { ok: true, restarting: true, message: "The installer is starting." };
}

/** macOS: an unsigned .app cannot be replaced underneath the user, so the
 *  downloaded image is opened and ReadLynx.app is dragged onto /Applications.
 *  The app quits so its bundle is not held open while it is copied. */
async function installOnMac(filePath: string): Promise<UpdateInstallResult> {
  const failure = await shell.openPath(filePath);
  if (failure) {
    return { ok: false, restarting: false, message: "", error: failure };
  }
  scheduleQuit();
  return {
    ok: true,
    restarting: true,
    message: /\.zip$/i.test(filePath)
      ? "Unzip ReadLynx and drag it onto Applications."
      : "Drag ReadLynx from the opened disk image onto Applications.",
  };
}

/** Linux: an AppImage is a single file, and the runtime exports its own path in
 *  `APPIMAGE` — so the running build knows exactly which file to overwrite.
 *  The new image is unpacked next to the old one and renamed over it, which
 *  leaves the current process running off its (now unlinked) image while the
 *  next start picks up the new one. */
async function replaceAppImage(filePath: string): Promise<{ ok: boolean; error?: string }> {
  const target = process.env.APPIMAGE;
  if (!target) return { ok: false, error: "Not running from an AppImage." };
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "readlynx-appimage-"));
  try {
    await fs.chmod(filePath, 0o755);
    // `--appimage-extract` unpacks the image into `squashfs-root` inside the
    // working directory instead of running it.
    await run(filePath, ["--appimage-extract"], workDir);
    const extracted = path.join(workDir, "squashfs-root");
    const staged = `${target}.readlynx-new`;
    await fs.rm(staged, { force: true });
    await fs.cp(extracted, staged, { recursive: true });
    await fs.chmod(staged, 0o755);
    await fs.rename(staged, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/** Linux: the AppImage is swapped in place. Anything else (a .deb, or an
 *  AppImage the user runs through a wrapper that hides `APPIMAGE`) is handed
 *  over instead — installing a package needs root and a package manager, which
 *  an in-app click should not be reaching for behind the user's back. */
async function installOnLinux(
  asset: UpdateAsset,
  filePath: string,
): Promise<UpdateInstallResult> {
  if (/\.AppImage$/i.test(asset.name)) {
    const replaced = await replaceAppImage(filePath);
    if (replaced.ok) {
      scheduleQuit();
      return {
        ok: true,
        restarting: true,
        message: "The new version is installed. Start ReadLynx again to use it.",
      };
    }
    console.log(`[updater] AppImage self-replace failed (${replaced.error}); falling back`);
  }
  const folder = path.dirname(filePath);
  await shell.openPath(folder);
  return {
    ok: true,
    restarting: false,
    message: `The new version is in ${folder} — replace the app with it, then start ReadLynx again.`,
  };
}

/** Downloads, verifies and installs the build picked by the last check. */
export async function installUpdate(
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateInstallResult> {
  const result = await latestChecked();
  if (!result.updateAvailable || !result.asset) {
    return {
      ok: false,
      restarting: false,
      message: "",
      error: "There is no update to install.",
    };
  }
  const asset = result.asset;

  const filePath = await downloadAsset(asset, onProgress);
  const checksumFailure = await verifyChecksum(asset, filePath, onProgress);
  if (checksumFailure) return checksumFailure;

  onProgress({
    phase: "installing",
    received: 0,
    total: 0,
    fraction: null,
    bytesPerSecond: 0,
    etaSeconds: null,
  });

  if (process.platform === "win32") return installOnWindows(filePath);
  if (process.platform === "darwin") return installOnMac(filePath);
  return installOnLinux(asset, filePath);
}