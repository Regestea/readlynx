import { Sparkles } from "lucide-react";
import styles from "./AiSelectionBubble.module.css";

interface AiSelectionBubbleProps {
  /** Viewport coords for the bubble (above the selection). */
  x: number;
  y: number;
  text: string;
  onAsk: (text: string) => void;
}

/** Circular "Ask AI" button that floats next to a text selection. */
export function AiSelectionBubble({ x, y, text, onAsk }: AiSelectionBubbleProps) {
  return (
    <button
      type="button"
      className={styles.bubble}
      style={{ left: x, top: y }}
      title="Ask AI about the selection"
      aria-label="Ask AI about the selection"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onAsk(text)}
    >
      <Sparkles size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
