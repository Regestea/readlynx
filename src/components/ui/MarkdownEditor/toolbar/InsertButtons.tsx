import { FileImage, Minus, Table, Type } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { $getSelection, $isRangeSelection } from "lexical";
import { $createCalloutNode } from "../nodes/CalloutNode";
import { $createCustomBlockNode } from "../nodes/CustomBlockNode";
import { insertImage } from "../plugins/ImagePlugin";
import { insertTable } from "../plugins/TablePlugin";
import type { CalloutTone, CustomBlockKind } from "../types";
import styles from "../MarkdownEditor.module.css";

interface InsertButtonsProps {
  disabled?: boolean;
}

export function InsertButtons({ disabled = false }: InsertButtonsProps) {
  const [editor] = useLexicalComposerContext();

  const onImage = () => {
    const src = window.prompt("Image URL");
    if (src) insertImage(editor, src);
  };

  const onTable = () => {
    insertTable(editor, {});
  };

  const onDivider = () => {
    editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
  };

  const onCallout = (tone: CalloutTone = "info") => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([$createCalloutNode(tone)]);
      }
    });
  };

  const onCustomBlock = (kind: CustomBlockKind = "aside") => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([$createCustomBlockNode(kind)]);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        className={styles.toolButton}
        title="Insert image"
        aria-label="Insert image"
        disabled={disabled}
        onClick={onImage}
      >
        <FileImage size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.toolButton}
        title="Insert table"
        aria-label="Insert table"
        disabled={disabled}
        onClick={onTable}
      >
        <Table size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.toolButton}
        title="Insert divider"
        aria-label="Insert divider"
        disabled={disabled}
        onClick={onDivider}
      >
        <Minus size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.toolButton}
        title="Insert callout"
        aria-label="Insert callout"
        disabled={disabled}
        onClick={() => onCallout("info")}
      >
        <Type size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.toolButton}
        title="Insert custom block"
        aria-label="Insert custom block"
        disabled={disabled}
        onClick={() => onCustomBlock("aside")}
      >
        <Type size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </>
  );
}
