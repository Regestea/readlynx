import { useEffect, useState } from "react";
import type { AiModel } from "../db/entities/AiModel";
import { getDefaultAiModel } from "./modelResolver";

export interface AiModelListState {
  /** Every saved model, in the order the app stores them. */
  models: AiModel[];
  /** The app default (`IsDefault`, else the first) — the initial pick. */
  defaultModel: AiModel | null;
  error: string | null;
}

/** Loads every saved AI model plus the default one — for UIs that let the user
 *  choose a model per conversation (e.g. the chat panel) instead of always
 *  falling back to the app default like `useDefaultAiModel` does. */
export function useAiModelList(): AiModelListState {
  const [state, setState] = useState<AiModelListState>({
    models: [],
    defaultModel: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const db = window.readlynx?.db;
      if (!db) {
        setState({ models: [], defaultModel: null, error: "The AI bridge is not available." });
        return;
      }
      try {
        const models = await db.listAiModels();
        if (cancelled) return;
        setState({
          models,
          defaultModel: getDefaultAiModel(models),
          error: models.length === 0 ? "No AI model configured. Add one in Settings → AI Models." : null,
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            models: [],
            defaultModel: null,
            error: err instanceof Error ? err.message : "Could not load AI models.",
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
