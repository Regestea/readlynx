import { ipcMain, net } from "electron";

/** The same free endpoint the original C# service used. No API key is
 *  required and it answers with `[[["translated", "original", …], …], …]`. */
const GOOGLE_TRANSLATE_URL = "https://translate.google.com/translate_a/single";

/** Longest piece sent in one GET. The endpoint accepts more, but keeping the
 *  URL bounded avoids proxy/server limits and keeps a single failure small. */
const MAX_CHUNK_CHARS = 5000;

/** Hard limit for one selection. A whole chapter pasted as a selection is not
 *  what this circle is for — the translation toolbar handles whole units. */
const MAX_SELECTION_CHARS = 20000;

const REQUEST_TIMEOUT_MS = 15000;

/** Google uses a few legacy/region codes that differ from the app's language
 *  ids. */
function googleLanguage(code: string): string {
  if (code === "zh-Hant") return "zh-TW";
  if (code === "zh") return "zh-CN";
  return code;
}

/** Splits a selection on line boundaries first, then on spaces, so each GET
 *  stays below `MAX_CHUNK_CHARS` without cutting words in half. */
function splitForTranslation(text: string): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current);
    current = "";
  };

  const pushLongLine = (line: string) => {
    let start = 0;
    while (start < line.length) {
      let end = Math.min(start + MAX_CHUNK_CHARS, line.length);
      if (end < line.length) {
        const space = line.lastIndexOf(" ", end);
        if (space > start + MAX_CHUNK_CHARS / 2) end = space;
      }
      chunks.push(line.slice(start, end));
      start = end;
      while (line[start] === " ") start += 1;
    }
  };

  for (const line of text.split("\n")) {
    if (line.length > MAX_CHUNK_CHARS) {
      flush();
      pushLongLine(line);
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > MAX_CHUNK_CHARS) {
      flush();
      current = line;
    } else {
      current = next;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [text];
}

/** Parses the endpoint's response exactly like the C# service: `data[0]` is
 *  the array of translated segments and each segment's `[0]` is a piece of
 *  the translation (or `null` for spacing/metadata entries). */
function parseGoogleResponse(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("unexpected response");
  }
  const segments = data[0];
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("unexpected response");
  }
  let translated = "";
  for (const segment of segments) {
    if (!Array.isArray(segment)) continue;
    const piece = segment[0];
    if (typeof piece === "string") translated += piece;
  }
  if (!translated.trim()) throw new Error("empty translation");
  return translated;
}

async function translateChunk(text: string, targetLang: string): Promise<string> {
  // Built by hand so the query matches the URL the service was tested with
  // (`%20` for spaces rather than `+`).
  const url =
    `${GOOGLE_TRANSLATE_URL}?client=gtx&sl=auto` +
    `&tl=${encodeURIComponent(googleLanguage(targetLang))}&dt=t&q=${encodeURIComponent(text)}`;

  // `net.fetch` goes through Chromium's network stack (the same one the
  // renderer uses), so it honours the system proxy. Node's global `fetch`
  // bypasses that proxy, which makes Google answer HTTP 429 on networks that
  // reach it through a local proxy/VPN.
  const response = await net.fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Google Translate answered HTTP ${response.status}.`);
  }
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Google Translate returned a non-JSON response.");
  }
  return parseGoogleResponse(payload).trim();
}

/** Registers the renderer bridge used by the selection-translation circle.
 *  The request runs in the main process so the renderer never talks to Google
 *  directly (no CORS, and the free endpoint rejects browser preflights). */
export function registerTranslateIpc() {
  ipcMain.handle(
    "translate:google",
    async (
      _event,
      payload: { text?: unknown; targetLang?: unknown },
    ): Promise<{ text: string }> => {
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      const targetLang = typeof payload?.targetLang === "string" ? payload.targetLang.trim() : "";
      if (!text) throw new Error("Nothing to translate.");
      if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z]{2,8})?$/.test(targetLang)) {
        throw new Error("Choose a valid target language.");
      }
      if (text.length > MAX_SELECTION_CHARS) {
        throw new Error(
          `The selection is too long to translate here (${text.length.toLocaleString()} characters, ` +
            `limit ${MAX_SELECTION_CHARS.toLocaleString()}).`,
        );
      }

      const parts: string[] = [];
      for (const chunk of splitForTranslation(text)) {
        parts.push(await translateChunk(chunk, targetLang));
      }
      return { text: parts.join("\n") };
    },
  );
}
