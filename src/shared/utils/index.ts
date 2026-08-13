export function greetingByHour(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${index === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/**
 * Parses a UTC timestamp stored by the app. SQLite writes `datetime('now')`
 * as "YYYY-MM-DD HH:MM:SS" — a space-separated string with no timezone
 * marker, which JS would otherwise read as *local* time (shifting it by the
 * UTC offset). It is normalized to ISO-with-Z before parsing, so the
 * resulting `Date` always represents the stored UTC instant. ISO strings
 * (e.g. `new Date().toISOString()`) and bare dates are accepted too.
 * Returns null for missing or unparseable values.
 */
export function parseStoredUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  let normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    normalized = `${normalized.replace(" ", "T")}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized = `${normalized}T00:00:00Z`;
  }
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** Formats a stored UTC timestamp as the local calendar date, e.g.
 *  "Aug 13, 2026". Returns "" when the value is missing or unparseable. */
export function formatStoredDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
): string {
  const date = parseStoredUtc(value);
  if (!date) return "";
  return date.toLocaleDateString(undefined, options);
}

const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** Formats a stored UTC timestamp as the local date and time, e.g.
 *  "Aug 13, 2026, 09:41 PM". Returns "" when unparseable. */
export function formatStoredDateTime(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_OPTIONS,
): string {
  const date = parseStoredUtc(value);
  if (!date) return "";
  return date.toLocaleString(undefined, options);
}

/** Formats a stored UTC timestamp relative to the current local time, e.g.
 *  "just now", "5m ago", "2h ago", "3d ago" — falling back to the local date
 *  for anything older than a week. */
export function formatStoredRelative(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  const date = parseStoredUtc(value);
  if (!date) return "";
  const diff = nowMs - date.getTime();
  if (diff < 45_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatStoredDate(value);
}
