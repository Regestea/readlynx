import OpenAI from "openai";
import { fetchWithLog } from "./httpLog.ts";

/** Shared shape for calling any OpenAI-compatible provider from the main
 *  process. Requests leave the app here, so the renderer never makes browser
 *  fetches to AI endpoints (which CORS blocks). */
export interface AiConnectionInput {
  url: string;
  apiKey: string;
  modelName: string;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiStructuredOptions {
  systemPrompt?: string;
  prompt: string;
  images?: string[];
  jsonSchema: Record<string, unknown>;
}

function createClient(input: AiConnectionInput): OpenAI {
  return new OpenAI({
    baseURL: input.url,
    apiKey: input.apiKey,
    // Log every request the SDK makes (see httpLog.ts).
    fetch: fetchWithLog,
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted."));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** True when the error is an intentional abort (user pressed Cancel). The
 *  OpenAI SDK throws `APIUserAbortError` on aborted requests; native fetch
 *  throws a `DOMException` named `AbortError`. */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === "AbortError" || name === "APIUserAbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /abort(ed)?/i.test(message);
}

/** True when the provider answered 429 (rate limited / quota exhausted). */
function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 429
  );
}

/** Runs `request` and retries it after a fixed delay when the provider
 *  rate-limits us, up to `maxAttempts` tries. Non-429 errors pass through
 *  immediately. `onRetry(attempt)` is called before each retry so the caller
 *  can update UI (e.g. show "retrying due to rate limit"). When `signal` is
 *  aborted (user pressed Cancel) the pending delay is interrupted and the
 *  abort error is re-thrown immediately instead of retrying. */
async function withRateLimitRetry<T>(
  request: () => Promise<T>,
  maxAttempts = 10,
  delayMs = 6000,
  onRetry?: (attempt: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted.");
    }
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (isAbortError(error)) {
        throw error;
      }
      if (!isRateLimitError(error) || attempt === maxAttempts) {
        throw error;
      }
      onRetry?.(attempt);
      await sleep(delayMs, signal);
    }
  }
  throw lastError;
}

/** Tiny completion that verifies an API key + model combination actually
 *  works before it is saved. Any successful response counts as a pass —
 *  some models return empty content, which is fine. */
export async function testConnection(
  input: AiConnectionInput,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const client = createClient(input);
    const completion = await client.chat.completions.create({
      model: input.modelName,
      messages: [{ role: "user", content: "Reply with a single word: pong" }],
      max_tokens: 8,
    });
    const content = completion.choices[0]?.message?.content?.trim();
    return { ok: true, message: content || undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Lists Gemini models that support `generateContent`. */
export async function listGeminiModels(
  apiKey: string,
): Promise<{ value: string; label: string }[]> {
  const response = await fetchWithLog(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch models. Please check your API key.");
  }

  const data = (await response.json()) as {
    models?: {
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }[];
  };

  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      value: m.name.replace("models/", ""),
      label: m.displayName || m.name.replace("models/", ""),
    }));
}

/** Plain chat completion over IPC (mirrors `sendChatMessage`). `images`
 *  (data URLs) are attached to the final user message, which lets vision
 *  models read pages directly. `onRetry(attempt)` is called before each
 *  rate-limit retry so the caller can surface it in the UI. When `signal` is
 *  aborted the in-flight HTTP request is cancelled and the 429 backoff sleep
 *  is interrupted, so a user Cancel resolves within milliseconds instead of
 *  waiting for the model response. */
export async function chatCompletion(
  input: AiConnectionInput,
  messages: AiChatMessage[],
  images?: string[],
  onRetry?: (attempt: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const client = createClient(input);
  const mapped: OpenAI.ChatCompletionMessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (images && images.length > 0 && mapped.length > 0) {
    const lastIndex = mapped.length - 1;
    const imageParts: OpenAI.ChatCompletionContentPartImage[] = images.map(
      (img) => ({ type: "image_url", image_url: { url: img } }),
    );
    mapped[lastIndex] = {
      role: "user",
      content: [
        { type: "text", text: messages[lastIndex].content },
        ...imageParts,
      ],
    };
  }
  const completion = await withRateLimitRetry(
    () =>
      client.chat.completions.create(
        {
          model: input.modelName,
          messages: mapped,
        },
        { signal },
      ),
    10,
    6000,
    onRetry,
    signal,
  );
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned an empty response.");
  }
  return content;
}

/** Structured JSON completion. The renderer passes a JSON schema (from its
 *  Zod form schemas via `toJSONSchema`), parsed here against the response.
 *  `signal` aborts the request the same way as `chatCompletion`. */
export async function structuredCompletion(
  input: AiConnectionInput,
  options: AiStructuredOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  const client = createClient(input);

  const userContent =
    options.images && options.images.length > 0
      ? [
          { type: "text" as const, text: options.prompt },
          ...options.images.map((img) => ({
            type: "image_url" as const,
            image_url: { url: img },
          })),
        ]
      : options.prompt;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    ...(options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : []),
    { role: "user", content: userContent },
  ];

  const completion = await withRateLimitRetry(
    () =>
      client.chat.completions.create(
        {
          model: input.modelName,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "structured",
              strict: true,
              schema: options.jsonSchema,
            },
          },
        },
        { signal },
      ),
    10,
    6000,
    undefined,
    signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI response could not be parsed against the schema.");
  }
  return JSON.parse(content);
}