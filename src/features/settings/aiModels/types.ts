import { z } from "zod";
import type { AiModel } from "../../../db/entities/AiModel.ts";

export const EMPTY_MODEL: AiModel = {
  Id: "",
  DisplayName: null,
  URL: null,
  ModelName: null,
  APIKey: null,
  Provider: "GoogleGemini",
};

export const PROVIDER_OPTIONS: { label: string; value: AiModel["Provider"] }[] = [
  { label: "Google Gemini", value: "GoogleGemini" },
  { label: "OpenRouter", value: "OpenRouter" },
  { label: "AvalAI", value: "AvalAi" },
  { label: "OpenAI", value: "OpenAi" },
  { label: "OpenAI Compatible", value: "OpenAiCompatible" },
];

export function providerLabel(provider: AiModel["Provider"]): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

export const aiModelFormSchema = z
  .object({
    DisplayName: z.string().trim().min(1, "Display name is required."),
    ModelName: z.string().trim().min(1, "Model name is required."),
    APIKey: z.string().trim().min(1, "API key is required."),
    Provider: z.enum(["GoogleGemini", "OpenRouter", "AvalAi", "OpenAi", "OpenAiCompatible"]),
    URL: z.string().trim(),
  })
  .superRefine((data, ctx) => {
    if (data.Provider !== "OpenAiCompatible") return;

    if (!data.URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["URL"],
        message: "URL is required.",
      });
      return;
    }

    const urlCheck = z
      .url("Enter a valid URL, e.g. https://api.example.com/v1 — the URL should end with /v1.")
      .safeParse(data.URL);

    if (!urlCheck.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["URL"],
        message: urlCheck.error.issues[0]?.message ?? "Enter a valid URL.",
      });
    }
  });

export type AiModelFormErrors = Partial<
  Record<keyof z.infer<typeof aiModelFormSchema>, string>
>;

export function validateFormModel(model: AiModel): {
  success: boolean;
  errors: AiModelFormErrors;
} {
  const result = aiModelFormSchema.safeParse({
    DisplayName: model.DisplayName ?? "",
    ModelName: model.ModelName ?? "",
    APIKey: model.APIKey ?? "",
    Provider: model.Provider,
    URL: model.URL ?? "",
  });

  if (result.success) {
    return { success: true, errors: {} };
  }

  const errors: AiModelFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof AiModelFormErrors;
    if (!errors[field]) {
      errors[field] = issue.message;
    }
  }
  return { success: false, errors };
}
