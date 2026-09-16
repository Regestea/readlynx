import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  chatCompletion,
  isAbortError,
  listGeminiModels,
  structuredCompletion,
  testConnection,
} from "../ai.ts";
import type {
  AiChatMessage,
  AiConnectionInput,
  AiStructuredOptions,
} from "../ai.ts";

/** In-flight AI requests by `requestId`, so the renderer can abort the
 *  exact HTTP call when the user presses Cancel instead of waiting for the
 *  model response at the next pipeline checkpoint. */
const pendingChatControllers = new Map<string, AbortController>();
const pendingStructuredControllers = new Map<string, AbortController>();

function track(pending: Map<string, AbortController>, requestId: string | undefined) {
  const id = requestId && requestId.length > 0 ? requestId : randomUUID();
  const controller = new AbortController();
  pending.set(id, controller);
  return {
    requestId: id,
    signal: controller.signal,
    done: () => {
      if (pending.get(id) === controller) pending.delete(id);
    },
  };
}

export function registerAiIpc() {
  ipcMain.handle("ai:test", (_event, input: AiConnectionInput) => testConnection(input));

  ipcMain.handle("ai:list-gemini-models", (_event, apiKey: string) =>
    listGeminiModels(apiKey),
  );

  ipcMain.handle(
    "ai:chat",
    async (
      event,
      payload: {
        input: AiConnectionInput;
        messages: AiChatMessage[];
        images?: string[];
        requestId?: string;
      },
    ) => {
      const tracked = track(pendingChatControllers, payload.requestId);
      try {
        return await chatCompletion(
          payload.input,
          payload.messages,
          payload.images,
          (attempt) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("ai:rate-limit-retry", { attempt });
            }
          },
          tracked.signal,
        );
      } catch (error) {
        // Normalize aborts so the renderer can tell "user cancelled" apart
        // from a real provider failure (no failover / no error toast).
        if (isAbortError(error) || tracked.signal.aborted) {
          const cancelled = new Error("Translation cancelled.");
          cancelled.name = "AbortError";
          throw cancelled;
        }
        throw error;
      } finally {
        tracked.done();
      }
    },
  );

  ipcMain.handle(
    "ai:structured",
    async (
      _event,
      payload: { input: AiConnectionInput; options: AiStructuredOptions; requestId?: string },
    ) => {
      const tracked = track(pendingStructuredControllers, payload.requestId);
      try {
        return await structuredCompletion(payload.input, payload.options, tracked.signal);
      } catch (error) {
        if (isAbortError(error) || tracked.signal.aborted) {
          const cancelled = new Error("Request cancelled.");
          cancelled.name = "AbortError";
          throw cancelled;
        }
        throw error;
      } finally {
        tracked.done();
      }
    },
  );

  ipcMain.handle("ai:cancel", (_event, requestId?: string) => {
    // With a `requestId` only that request is aborted (translation passes
    // one id per `ai.chat` call); without it every in-flight AI request is
    // aborted — the Cancel button uses this as a fire-and-forget.
    if (typeof requestId === "string" && requestId.length > 0) {
      const chat = pendingChatControllers.get(requestId);
      if (chat) {
        chat.abort(new Error("Translation cancelled."));
        return true;
      }
      const structured = pendingStructuredControllers.get(requestId);
      if (structured) {
        structured.abort(new Error("Request cancelled."));
        return true;
      }
      return false;
    }
    let aborted = false;
    for (const controller of pendingChatControllers.values()) {
      controller.abort(new Error("Translation cancelled."));
      aborted = true;
    }
    for (const controller of pendingStructuredControllers.values()) {
      controller.abort(new Error("Request cancelled."));
      aborted = true;
    }
    return aborted;
  });
}
