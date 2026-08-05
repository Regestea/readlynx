import { toJSONSchema } from "zod";
import type { z } from "zod";

/** All provider requests run in the Electron main process (`readlynx.ai`),
 *  so the browser never fetches AI endpoints and CORS does not apply. The
 *  renderer only serializes the request and awaits the IPC result. */

export interface AiConnection {
  url: string;
  apiKey: string;
  modelName: string;
}

interface FetchStructuredOptions<T> {
  url: string;
  apiKey: string;
  modelName: string;
  schema: z.ZodType<T>;
  prompt: string;
  systemPrompt?: string;
  images?: string[];
}

/** Calls the native bridge with a Zod schema (converted to a JSON schema)
 *  and returns the parsed structured response. */
export async function fetchStructuredAI<T>(options: FetchStructuredOptions<T>): Promise<T> {
  const bridge = window.readlynx?.ai;
  if (!bridge) {
    throw new Error("AI bridge is not available.");
  }

  const result = await bridge.structured({
    input: {
      url: options.url,
      apiKey: options.apiKey,
      modelName: options.modelName,
    },
    options: {
      systemPrompt: options.systemPrompt,
      prompt: options.prompt,
      images: options.images,
      jsonSchema: toJSONSchema(options.schema) as Record<string, unknown>,
    },
  });

  return result as T;
}

/** Sends a tiny request via the main process to verify an API key + model
 *  combination works. Returns the provider message (or the failure reason). */
export async function testApiConnection(
  url: string,
  apiKey: string,
  modelName: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const bridge = window.readlynx?.ai;
  if (!bridge) {
    return { ok: false, error: "AI bridge is not available." };
  }
  try {
    return await bridge.testConnection({ url, apiKey, modelName });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Test failed",
    };
  }
}

/** Kept for callers that want a plain true/false + console logging. */
export async function testApi(
  url: string,
  apiKey: string,
  modelName: string,
): Promise<boolean> {
  const result = await testApiConnection(url, apiKey, modelName);
  if (!result.ok) {
    console.error("testApi failed:", result.error);
  }
  return result.ok;
}