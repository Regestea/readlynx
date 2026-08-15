import { useEffect, useState } from "react";
import type { AiModel } from "../../../../infrastructure/db/entities/AiModel.ts";

function getDb() {
  return window.readlynx?.db;
}

/** CRUD over the saved AI models, backed by the SQLite `AiModels` table. */
export function useAiModels() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getDb()
      ?.listAiModels()
      .then((data) => {
        if (cancelled) return;
        setModels(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    const data = await getDb()?.listAiModels();
    if (data) setModels(data);
  };

  /** Adds a model. The first model added is automatically the default (the
   *  worker enforces this too), so the local list mirrors it. */
  const addModel = async (model: AiModel) => {
    await getDb()?.createAiModel(model);
    setModels((prev) => [...prev, { ...model, IsDefault: prev.length === 0 || model.IsDefault }]);
  };

  const updateModel = async (model: AiModel) => {
    await getDb()?.updateAiModel(model);
    setModels((prev) => prev.map((m) => (m.Id === model.Id ? model : m)));
  };

  const deleteModel = async (id: string) => {
    await getDb()?.deleteAiModel(id);
    setModels((prev) => prev.filter((m) => m.Id !== id));
  };

  /** Marks a model as the default (clearing the flag on the others). */
  const setDefaultModel = async (id: string) => {
    const ok = await getDb()?.setDefaultAiModel(id);
    if (ok) {
      setModels((prev) => prev.map((m) => ({ ...m, IsDefault: m.Id === id })));
    }
  };

  return { models, loading, refresh, addModel, updateModel, deleteModel, setDefaultModel };
}
