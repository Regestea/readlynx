import { Redo2, Undo2 } from "lucide-react";
import { useEditorAPI } from "../context";
import type { ToolbarState } from "../types";
import styles from "../MarkdownEditor.module.css";

interface HistoryButtonsProps {
  state: ToolbarState;
}

export function HistoryButtons({ state }: HistoryButtonsProps) {
  const api = useEditorAPI();

  return (
    <>
      <button
        type="button"
        className={styles.toolButton}
        title="Undo (Ctrl/Cmd+Z)"
        aria-label="Undo"
        disabled={!state.canUndo}
        onClick={api.undo}
      >
        <Undo2 size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.toolButton}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        aria-label="Redo"
        disabled={!state.canRedo}
        onClick={api.redo}
      >
        <Redo2 size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </>
  );
}
