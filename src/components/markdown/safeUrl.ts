/**
 * Decides which URLs the Markdown renderer may navigate to or load.
 *
 * Links (`href`) are clickable only when they point at a real website:
 * anything else - empty hrefs, `#fragments`, relative book paths, mailto:,
 * and so on - would navigate the app window nowhere useful, so it becomes
 * "" and the link renders as inert text instead.
 *
 * Image sources (`src`) keep the extra schemes the app itself produces
 * (https, data:, the persisted translation-image protocol) - everything
 * else stays restricted.
 */
export function safeUrlTransform(url: string, key: string): string {
  if (key === "href") {
    return /^https?:\/\//i.test(url) ? url : "";
  }
  try {
    // NOTE: URL.protocol always ends with ":" (e.g. "https:") — the pattern
    // must account for it, otherwise nothing ever matches.
    const parsed = new URL(url, "https://example.com");
    const allowed =
      /^(https?|ircs?|mailto|xmpp):$/i.test(parsed.protocol) ||
      (key === "src" && parsed.protocol === "data:") ||
      (key === "src" && parsed.protocol === "readlynx-translation-image:");
    return allowed ? url : "";
  } catch {
    return "";
  }
}
