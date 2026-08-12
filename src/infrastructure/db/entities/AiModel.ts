/** Supported AI model providers. */
export type AiProvider =
  | "GoogleGemini"
  | "OpenRouter"
  | "AvalAi"
  | "OpenAi"
  | "OpenAiCompatible";

/** Row of the `AiModels` table. API keys are stored locally so the app can
 *  call the provider directly from the renderer. `IsDefault` marks the model
 *  used by features that need a model without asking (e.g. reading
 *  translation). */
export interface AiModel {
  Id: string;
  DisplayName: string | null;
  URL: string | null;
  ModelName: string | null;
  APIKey: string | null;
  Provider: AiProvider;
  IsDefault: boolean;
}