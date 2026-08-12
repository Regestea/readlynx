import { useEffect, useState } from "react";
import type { AiModel } from "../db/entities/AiModel";
import { getDefaultAiModel } from "./modelResolver";

export interface DefaultAiModelState {
  model: AiModel | null;
  ready: boolean;
  error: string | null;
}

/** Loads the saved AI models once and resolves the default one — the same
 *  pick used by the chat panel and the translation panel. */
export function useDefaultAiModel(): DefaultAiModelState {
  const [state, setState] = useState<DefaultAiModelState>({
    model: null,
    ready: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const db = window.readlynx?.db;
      if (!db) {
        setState({ model: null, ready: true, error: "The AI bridge is not available." });
        return;
      }
      try {
        const models = await db.listAiModels();
        if (cancelled) return;
        const model = getDefaultAiModel(models);
        setState({
          model,
          ready: true,
          error: model ? null : "No AI model configured. Add one in Settings → AI Models.",
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            model: null,
            ready: true,
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