import { BrowserWindow } from "electron";

/** Native HTTP requests (AI providers, OCR model downloads, …) leave the app
 *  from the main process, so they never show up in the renderer Network tab.
 *  These helpers log every request — method, URL, status, size and duration —
 *  both to the terminal and, via IPC, into the DevTools console of every
 *  window. */

export interface HttpLogInfo {
  method: string;
  url: string;
  status?: number;
  bytes?: number;
  durationMs?: number;
  error?: string;
  detail?: string;
  body?: unknown;
}

const SENSITIVE_PARAM = /(key|api[-_]?key|apikey|token|auth|secret|password)/i;

/** Longest pretty-printed body kept in the terminal output; the DevTools
 *  console receives the full object instead. */
const MAX_TERMINAL_BODY_CHARS = 20000;

/** Strips values of credential-ish query parameters (e.g. `?key=…` on the
 *  Gemini endpoint) before a URL is logged. */
function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const [name, value] of [...url.searchParams]) {
      if (SENSITIVE_PARAM.test(name)) {
        url.searchParams.set(name, value ? "***" : "");
      }
    }
    return url.toString();
  } catch {
    return rawUrl.replace(
      /([?&](key|api[-_]?key|apikey|token|auth|secret|password)=)[^&#]+/gi,
      "$1***",
    );
  }
}

/** Replaces data-URL images with a size marker so bodies stay loggable. */
function redactBodyJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBodyJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (
        key === "image_url" &&
        val !== null &&
        typeof val === "object" &&
        typeof (val as { url?: unknown }).url === "string" &&
        (val as { url: string }).url.startsWith("data:")
      ) {
        out[key] = { url: `[data-url, ${(val as { url: string }).url.length} chars]` };
      } else {
        out[key] = redactBodyJson(val);
      }
    }
    return out;
  }
  return value;
}

/** Prepares a JSON request body for logging (redacted). Also returns the
 *  `model` field so AI requests can be labelled. */
function prepareBody(body: string): { body: unknown; model?: string } {
  try {
    const parsed = JSON.parse(body) as { model?: string };
    return {
      body: redactBodyJson(parsed),
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    };
  } catch {
    return { body };
  }
}

function lineFor(info: HttpLogInfo): string {
  const parts = [
    info.method,
    redactUrl(info.url),
    info.detail,
    info.status !== undefined ? `-> ${info.status}` : null,
    info.bytes !== undefined ? `${info.bytes} bytes` : null,
    info.durationMs !== undefined ? `${info.durationMs} ms` : null,
    info.error ? `ERROR: ${info.error}` : null,
  ].filter((part): part is string => part !== null);
  return `[http] ${parts.join(" ")}`;
}

export function logHttpRequest(info: HttpLogInfo): void {
  const line = lineFor(info);
  console.log(line);
  if (info.body !== undefined) {
    const text = JSON.stringify(info.body, null, 2);
    console.log(
      text.length > MAX_TERMINAL_BODY_CHARS
        ? `${text.slice(0, MAX_TERMINAL_BODY_CHARS)}…`
        : text,
    );
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("http:log", { line, body: info.body });
    }
  }
}

/** `fetch` drop-in that logs each request. Picks the model name out of JSON
 *  bodies (the OpenAI SDK sends `{ model, … }`) so AI calls are identifiable. */
export async function fetchWithLog(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method =
    init?.method ??
    (typeof input === "object" && "method" in input ? input.method : undefined) ??
    "GET";
  let detail: string | undefined;
  let body: unknown;
  if (typeof init?.body === "string" && init.body.length > 0) {
    const prepared = prepareBody(init.body);
    body = prepared.body;
    detail = prepared.model ? `model=${prepared.model}` : undefined;
  }
  const started = performance.now();
  try {
    const response = await fetch(input, init);
    const bytes = Number(response.headers.get("content-length")) || undefined;
    logHttpRequest({
      method: method.toUpperCase(),
      url,
      detail,
      body,
      status: response.status,
      bytes,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  } catch (error) {
    logHttpRequest({
      method: method.toUpperCase(),
      url,
      detail,
      body,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - started),
    });
    throw error;
  }
}
