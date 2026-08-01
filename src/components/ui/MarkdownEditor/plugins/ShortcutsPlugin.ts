import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_NORMAL,
  KEY_ESCAPE_COMMAND,
  KEY_MODIFIER_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";

interface ShortcutsPluginProps {
  onSave?: () => void;
}

export function ShortcutsPlugin({ onSave }: ShortcutsPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (event) => {
        const modKey = event.ctrlKey || event.metaKey;
        if (!modKey) return false;
        const key = event.key.toLowerCase();
        if (key === "s") {
          event.preventDefault();
          onSave?.();
          return true;
        }
        if (key === "z" && event.shiftKey) {
          event.preventDefault();
          editor.dispatchCommand(REDO_COMMAND, undefined);
          return true;
        }
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          editor.dispatchCommand(UNDO_COMMAND, undefined);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [editor, onSave]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        editor.blur();
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [editor]);

  return null;
}
