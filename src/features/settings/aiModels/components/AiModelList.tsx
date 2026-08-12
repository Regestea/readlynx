import { Bot, Pencil, Star, Trash2 } from "lucide-react";
import type { AiModel } from "../../../../infrastructure/db/entities/AiModel.ts";
import { providerLabel } from "../types.ts";
import styles from "../aiModels.module.css";

interface AiModelListProps {
  models: AiModel[];
  onEdit: (model: AiModel) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

export function AiModelList({ models, onEdit, onDelete, onSetDefault }: AiModelListProps) {
  if (models.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon} aria-hidden="true">
          <Bot size={20} strokeWidth={1.8} />
        </span>
        <p className={styles.emptyText}>No AI models added yet.</p>
        <p className={styles.emptyHint}>
          Add a model so ReadLynx can use it for summaries, translations and smart features.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {models.map((model) => (
        <div className={styles.item} key={model.Id}>
          <div className={styles.itemInfo}>
            <span className={styles.itemTitle}>
              {model.DisplayName ?? model.ModelName ?? "Untitled model"}
              {model.IsDefault && <span className={styles.defaultBadge}>Default</span>}
            </span>
            <span className={styles.itemMeta}>
              <span className={styles.badge}>{providerLabel(model.Provider)}</span>
              {model.ModelName}
            </span>
          </div>
          <div className={styles.itemActions}>
            {!model.IsDefault && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => onSetDefault(model.Id)}
                aria-label={`Set ${model.DisplayName ?? model.ModelName ?? "model"} as default`}
                title="Use as default model"
              >
                <Star size={16} strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => onEdit(model)}
              aria-label={`Edit ${model.DisplayName ?? model.ModelName ?? "model"}`}
              title="Edit"
            >
              <Pencil size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButtonDanger}`}
              onClick={() => onDelete(model.Id)}
              aria-label={`Delete ${model.DisplayName ?? model.ModelName ?? "model"}`}
              title="Delete"
            >
              <Trash2 size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}