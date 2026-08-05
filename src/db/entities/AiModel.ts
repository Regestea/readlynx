/** Supported AI model providers. */
export type AiProvider =
  | "GoogleGemini"
  | "OpenRouter"
  | "AvalAi"
  | "OpenAi"
  | "OpenAiCompatible";

/** Row of the `AiModels` table. API keys are stored locally so the app can
 *  call the provider directly from the renderer. */
export interface AiModel {
  Id: string;
  DisplayName: string | null;
  URL: string | null;
  ModelName: string | null;
  APIKey: string | null;
  Provider: AiProvider;
}