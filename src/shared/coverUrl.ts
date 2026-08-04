const COVER_SCHEME = "readlynx-cover";

/** Resolves a stored cover reference to something an `<img>` can load:
 *  - data URL → returned as-is (freshly picked, not saved yet)
 *  - relative path (`covers/<file>`) → app protocol URL served by the main
 *    process (null outside Electron, where the protocol is unavailable)
 *  - already a `readlynx-cover://` URL → returned as-is
 */
export function coverUrl(coverImage: string | null): string | null {
  if (!coverImage) return null;
  if (coverImage.startsWith("data:") || coverImage.startsWith(`${COVER_SCHEME}://`)) {
    return coverImage;
  }
  if (typeof window === "undefined" || !window.readlynx) return null;
  return `${COVER_SCHEME}://local/${coverImage.replace(/\\/g, "/")}`;
}
