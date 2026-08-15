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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 *  immediately. */
async function withRateLimitRetry<T>(
  request: () => Promise<T>,
  maxAttempts = 10,
  delayMs = 6000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(delayMs);
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
 *  models read pages directly. */
export async function chatCompletion(
  input: AiConnectionInput,
  messages: AiChatMessage[],
  images?: string[],
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
  const completion = await withRateLimitRetry(() =>
    client.chat.completions.create({
      model: input.modelName,
      messages: mapped,
    }),
  );
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned an empty response.");
  }
  return content;
}

/** Structured JSON completion. The renderer passes a JSON schema (from its
 *  Zod form schemas via `toJSONSchema`), parsed here against the response. */
export async function structuredCompletion(
  input: AiConnectionInput,
  options: AiStructuredOptions,
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

  const completion = await withRateLimitRetry(() =>
    client.chat.completions.create({
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
    }),
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI response could not be parsed against the schema.");
  }
  return JSON.parse(content);
}