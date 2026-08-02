import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link,
  Link2Off,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { FORMAT_TEXT_COMMAND, type TextFormatType } from "lexical";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import type { ToolbarState } from "../types";
import styles from "../DocumentEditor.module.css";

interface TextFormatButtonsProps {
  state: ToolbarState;
}

interface FormatButton {
  format: TextFormatType;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

export function TextFormatButtons({ state }: TextFormatButtonsProps) {
  const [editor] = useLexicalComposerContext();

  const toggleFormat = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const toggleLink = () => {
    if (state.isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const url = window.prompt("Link URL", "https://");
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  };

  const buttons: FormatButton[] = [
    { format: "bold", icon: <Bold size={15} strokeWidth={2} />, label: "Bold", shortcut: "Ctrl/Cmd+B" },
    { format: "italic", icon: <Italic size={15} strokeWidth={2} />, label: "Italic", shortcut: "Ctrl/Cmd+I" },
    { format: "underline", icon: <Underline size={15} strokeWidth={2} />, label: "Underline", shortcut: "Ctrl/Cmd+U" },
    { format: "strikethrough", icon: <Strikethrough size={15} strokeWidth={2} />, label: "Strikethrough", shortcut: "Ctrl/Cmd+Shift+S" },
    { format: "highlight", icon: <Highlighter size={15} strokeWidth={2} />, label: "Highlight", shortcut: "" },
    { format: "code", icon: <Code size={15} strokeWidth={2} />, label: "Inline code", shortcut: "Ctrl/Cmd+K" },
  ];

  return (
    <>
      {buttons.map(({ format, icon, label, shortcut }) => (
        <button
          key={format}
          type="button"
          className={[
            styles.toolButton,
            state[format as keyof ToolbarState] ? styles.toolButtonActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={shortcut ? `${label} (${shortcut})` : label}
          aria-label={label}
          aria-pressed={Boolean(state[format as keyof ToolbarState])}
          onClick={() => toggleFormat(format)}
        >
          {icon}
        </button>
      ))}
      <button
        type="button"
        className={[
          styles.toolButton,
          state.isLink ? styles.toolButtonActive : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={state.isLink ? "Remove link" : "Add link (Ctrl/Cmd+L)"}
        aria-label={state.isLink ? "Remove link" : "Add link"}
        aria-pressed={state.isLink}
        onClick={toggleLink}
      >
        {state.isLink ? (
          <Link2Off size={15} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Link size={15} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </>
  );
}
