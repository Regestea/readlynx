import { useCallback, useEffect, useRef } from "react";
import type { AiModel } from "../../../infrastructure/db/entities/AiModel.ts";
import { getDefaultAiModel, resolveProviderBaseUrl } from "../../../infrastructure/ai/modelResolver.ts";
import type {
  SelectionTranslationProvider,
  SelectionTranslationResult,
} from "../../../shared/selectionTranslation.ts";
import { languageLabel, NO_LANGUAGE } from "./languages.ts";

interface SelectionTranslationOptions {
  /** Every saved AI model. */
  models: AiModel[];
  /** Output language shared with the reading toolbar. */
  targetLang: string;
}

interface SelectionTranslation {
  /** Translates one selection through the provider chosen in Settings. */
  translateSelection: (text: string) => Promise<SelectionTranslationResult>;
}

/** The translated text of one reader selection.
 *
 *  The provider and AI model are read from `AppSettings` on every call rather
 *  than kept in state here: Settings can change while a book is open, and a
 *  reader window has no subscription to that change. The call itself is
 *  deliberately independent of `useTranslation` — its cancel/retry/busy state
 *  belongs to whole-page translation and must not be disturbed by a one-off
 *  popover. */
export function useSelectionTranslation({
  models,
  targetLang,
}: SelectionTranslationOptions): SelectionTranslation {
  const modelsRef = useRef(models);
  const targetLangRef = useRef(targetLang);

  useEffect(() => {
    modelsRef.current = models;
    targetLangRef.current = targetLang;
  }, [models, targetLang]);

  const translateSelection = useCallback(
    async (text: string): Promise<SelectionTranslationResult> => {
      const selection = text.trim();
      if (!selection) throw new Error("There is no selected text to translate.");

      const lang = targetLangRef.current;
      if (!lang || lang === NO_LANGUAGE) {
        throw new Error("Choose a translation language in the reading toolbar first.");
      }

      // `getAppSettings` can fail (worker restarting, no bridge in a test);
      // Google Translate is the default then, matching the column default.
      let provider: SelectionTranslationProvider = "google";
      let modelId = "";
      try {
        const settings = await window.readlynx?.db.getAppSettings();
        if (settings?.selectionTranslationProvider === "ai") provider = "ai";
        if (settings?.selectionTranslationModelId) modelId = settings.selectionTranslationModelId;
      } catch {
        // Keep the default.
      }

      if (provider === "google") {
        const bridge = window.readlynx?.translate;
        if (!bridge) throw new Error("The Google Translate bridge is not available.");
        const result = await bridge.google({ text: selection, targetLang: lang });
        const translated = result.text.trim();
        if (!translated) throw new Error("Google Translate returned an empty translation.");
        return { text: translated, provider };
      }

      const ai = window.readlynx?.ai;
      if (!ai) throw new Error("The AI bridge is not available.");

      const candidates = aiModelCandidates(modelsRef.current, modelId);
      if (candidates.length === 0) {
        throw new Error(
          "No AI model is configured. Add one in Settings → AI Models, or choose " +
            "Google Translate for selection translation in Settings.",
        );
      }

      const target = languageLabel(lang);
      const messages = [
        {
          role: "system" as const,
          content:
            `You translate text for a reader. Translate the user's text into ${target}. ` +
            "Preserve the original line breaks, paragraphs and punctuation. " +
            "Return only the translation — no quotes, labels, explanations or notes. " +
            `If the text is already in ${target}, return it unchanged.`,
        },
        { role: "user" as const, content: selection },
      ];

      const failures: string[] = [];
      for (const model of candidates) {
        const label = model.DisplayName ?? model.ModelName ?? model.Id;
        if (!model.APIKey || !model.ModelName) {
          failures.push(`${label}: missing an API key or model name`);
          continue;
        }
        let url: string;
        try {
          url = resolveProviderBaseUrl(model);
        } catch (error) {
          failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        try {
          const response = await ai.chat({
            input: { url, apiKey: model.APIKey, modelName: model.ModelName },
            messages,
          });
          const translated = response.trim();
          if (translated) return { text: translated, provider };
          failures.push(`${label}: returned an empty translation`);
        } catch (error) {
          failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(
        candidates.length === 1
          ? `Could not translate the selection — ${failures[0]}`
          : `All ${candidates.length} models failed — ${failures.join("; ")}`,
      );
    },
    [],
  );

  return { translateSelection };
}

/** The AI model chosen in Settings first, then the app default as a fallback —
 *  the selected model may have been deleted since it was saved. */
function aiModelCandidates(models: AiModel[], modelId: string): AiModel[] {
  const picked: AiModel[] = [];
  const chosen = modelId ? models.find((model) => model.Id === modelId) : undefined;
  if (chosen) picked.push(chosen);
  const fallback = getDefaultAiModel(models);
  if (fallback && !picked.includes(fallback)) picked.push(fallback);
  return picked;
}
