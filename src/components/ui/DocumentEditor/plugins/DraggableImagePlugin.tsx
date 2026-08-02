import { useEffect } from "react";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isElementNode,
  $isRootNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DRAGEND_COMMAND,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";

const IMAGE_SELECTOR = "[data-lexical-image]";
const DROP_INDICATOR_CLASS = "__readlynx-drop-target";

let dragKey: NodeKey | null = null;
let dropTarget: HTMLElement | null = null;

function setDropHighlight(element: HTMLElement | null) {
  if (dropTarget === element) return;
  dropTarget?.classList.remove(DROP_INDICATOR_CLASS);
  dropTarget = element;
  dropTarget?.classList.add(DROP_INDICATOR_CLASS);
}

/** Walk up from a DOM node to the top-level block element whose parent is the root. */
function getTopLevelBlock(domNode: Node, editor: LexicalEditor): {
  node: ReturnType<typeof $getNearestNodeFromDOMNode>;
  element: HTMLElement | null;
} | null {
  let result: { node: ReturnType<typeof $getNearestNodeFromDOMNode>; element: HTMLElement | null } | null =
    null;
  editor.getEditorState().read(() => {
    const node = $getNearestNodeFromDOMNode(domNode);
    if (!node) return;
    let current = $isElementNode(node) ? node : node.getParent();
    while (current && current.getParent() && !$isRootNode(current.getParent())) {
      current = current.getParent();
    }
    if (!current || !current.getParent() || !$isRootNode(current.getParent())) return;
    const element = editor.getElementByKey(current.getKey());
    if (!element) return;
    result = { node: current, element };
  });
  return result;
}

function getDropPoint(event: DragEvent, editor: LexicalEditor): {
  node: ReturnType<typeof $getNearestNodeFromDOMNode>;
  element: HTMLElement;
  position: "before" | "after";
} | null {
  const block = getTopLevelBlock(event.target as Node, editor);
  if (!block || !block.element) return null;
  const rect = block.element.getBoundingClientRect();
  const position: "before" | "after" = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  return { node: block.node, element: block.element, position };
}

export function DraggableImagePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.isEditable()) return;

    return mergeRegister(
      editor.registerCommand<DragEvent>(
        DRAGSTART_COMMAND,
        (event) => {
          const figure = (event.target as HTMLElement).closest<HTMLElement>(IMAGE_SELECTOR);
          if (!figure) return false;
          const key = editor.getEditorState().read(() => {
            const node = $getNearestNodeFromDOMNode(figure);
            return node ? node.getKey() : null;
          });
          if (!key) return false;
          dragKey = key;
          event.dataTransfer?.setData("text/plain", key);
          event.dataTransfer!.effectAllowed = "move";
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand<DragEvent>(
        DRAGOVER_COMMAND,
        (event) => {
          const point = getDropPoint(event, editor);
          if (point && point.node && dragKey !== point.node.getKey()) {
            setDropHighlight(point.element);
          } else {
            setDropHighlight(null);
          }
          event.preventDefault();
          event.dataTransfer!.dropEffect = "move";
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<DragEvent>(
        DROP_COMMAND,
        (event) => {
          const key = dragKey ?? event.dataTransfer?.getData("text/plain");
          const point = getDropPoint(event, editor);
          setDropHighlight(null);
          dragKey = null;
          if (!key || !point || !point.node) return false;
          if (key === point.node.getKey()) return true;
          event.preventDefault();
          editor.update(() => {
            const dragged = $getNodeByKey(key);
            if (!dragged || !$isElementNode(dragged) || !point.node) return;
            if (dragged === point.node) return;
            if (point.position === "before") point.node.insertBefore(dragged);
            else point.node.insertAfter(dragged);
          });
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand<DragEvent>(
        DRAGEND_COMMAND,
        () => {
          setDropHighlight(null);
          dragKey = null;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  return null;
}
