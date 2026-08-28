import { ipcMain } from "electron";
import {
  chatCompletion,
  listGeminiModels,
  structuredCompletion,
  testConnection,
} from "../ai.ts";
import type {
  AiChatMessage,
  AiConnectionInput,
  AiStructuredOptions,
} from "../ai.ts";

export function registerAiIpc() {
  ipcMain.handle("ai:test", (_event, input: AiConnectionInput) => testConnection(input));

  ipcMain.handle("ai:list-gemini-models", (_event, apiKey: string) =>
    listGeminiModels(apiKey),
  );

  ipcMain.handle(
    "ai:chat",
    (
      event,
      payload: { input: AiConnectionInput; messages: AiChatMessage[]; images?: string[] },
    ) =>
      chatCompletion(payload.input, payload.messages, payload.images, (attempt) => {
        event.sender.send("ai:rate-limit-retry", { attempt });
      }),
  );

  ipcMain.handle(
    "ai:structured",
    (_event, payload: { input: AiConnectionInput; options: AiStructuredOptions }) =>
      structuredCompletion(payload.input, payload.options),
  );
}
