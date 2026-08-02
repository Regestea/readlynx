import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  type ElementNode,
} from "lexical";
import { isRtlDominant } from "../utils/direction";

function desiredDirection(element: ElementNode): "rtl" | "ltr" {
  return isRtlDominant(element.getTextContent()) ? "rtl" : "ltr";
}

function $collectDirectionChanges(): { key: string; direction: "rtl" | "ltr" }[] {
  const changes: { key: string; direction: "rtl" | "ltr" }[] = [];
  const selection = $getSelection();

  if ($isRangeSelection(selection)) {
    // Follow the caret: only the block being edited needs a direction pass.
    const topLevel = $findMatchingParent(selection.anchor.getNode(), (node) => {
      const parent = node.getParent();
      return parent !== null && $isRootNode(parent);
    }) as ElementNode | null;
    if (topLevel) {
      const direction = desiredDirection(topLevel);
      if (topLevel.getDirection() !== direction) {
        changes.push({ key: topLevel.getKey(), direction });
      }
    }
    return changes;
  }

  // No caret (e.g. right after a programmatic load): sweep the top-level blocks.
  for (const child of $getRoot().getChildren()) {
    if (!$isElementNode(child)) continue;
    const direction = desiredDirection(child);
    if (child.getDirection() !== direction) {
      changes.push({ key: child.getKey(), direction });
    }
  }
  return changes;
}

/**
 * Sets `dir` on top-level blocks based on the dominant language of their text.
 * This keeps bidi layout, caret placement and caret movement correct when
 * mixing Persian/Arabic and Latin text.
 */
export function AutoDirectionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const changes = editor.getEditorState().read($collectDirectionChanges);
      if (changes.length === 0) return;
      editor.update(() => {
        for (const { key, direction } of changes) {
          const node = $getNodeByKey(key) as ElementNode | null;
          if (node) node.setDirection(direction);
        }
      });
    });
  }, [editor]);

  return null;
}
