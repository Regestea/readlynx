import type { AiModel } from "../db/entities/AiModel.ts";

export const PROVIDER_BASE_URLS: Record<
  Exclude<AiModel["Provider"], "OpenAiCompatible">,
  string
> = {
  GoogleGemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  OpenRouter: "https://openrouter.ai/api/v1",
  AvalAi: "https://api.avalai.ir/v1",
  OpenAi: "https://api.openai.com/v1",
};

/** Resolves the OpenAI-compatible base URL for a saved model. */
export function resolveProviderBaseUrl(model: AiModel): string {
  if (model.Provider === "OpenAiCompatible") {
    if (!model.URL) {
      throw new Error(
        "This model uses the OpenAI-compatible provider but has no URL configured.",
      );
    }
    return model.URL;
  }

  return PROVIDER_BASE_URLS[model.Provider];
}

/** Picks the default saved model (the `IsDefault` flag, else the first). */
export function getDefaultAiModel(models: AiModel[]): AiModel | null {
  return models.find((entry) => entry.IsDefault) ?? models[0] ?? null;
}
