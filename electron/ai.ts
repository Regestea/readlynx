import OpenAI from "openai";

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
  });
}

/** Tiny completion that verifies an API key + model combination actually
 *  works before it is saved. */
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
    return content
      ? { ok: true, message: content }
      : { ok: false, error: "The provider returned an empty response." };
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
  const response = await fetch(
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

/** Plain chat completion over IPC (mirrors `sendChatMessage`). */
export async function chatCompletion(
  input: AiConnectionInput,
  messages: AiChatMessage[],
): Promise<string> {
  const client = createClient(input);
  const completion = await client.chat.completions.create({
    model: input.modelName,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
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

  const completion = await client.chat.completions.create({
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
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI response could not be parsed against the schema.");
  }
  return JSON.parse(content);
}