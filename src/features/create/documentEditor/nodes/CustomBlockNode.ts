import type {
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from "lexical";
import { $applyNodeReplacement, ElementNode } from "lexical";
import type { CustomBlockKind } from "../types";

export type SerializedCustomBlockNode = Spread<
  { kind: CustomBlockKind; version: 1 },
  SerializedElementNode
>;

function $convertCustomBlockElement(element: HTMLElement) {
  const kind = (element.getAttribute("data-block-kind") as CustomBlockKind | null) ?? "aside";
  return { node: $createCustomBlockNode(kind) };
}

export class CustomBlockNode extends ElementNode {
  __kind: CustomBlockKind;

  static getType(): string {
    return "custom-block";
  }

  static clone(node: CustomBlockNode): CustomBlockNode {
    return new CustomBlockNode(node.__kind, node.__key);
  }

  static importJSON(serializedNode: SerializedCustomBlockNode): CustomBlockNode {
    return $createCustomBlockNode(serializedNode.kind).updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      section: () => ({ conversion: $convertCustomBlockElement, priority: 0 }),
    };
  }

  constructor(kind: CustomBlockKind = "aside", key?: NodeKey) {
    super(key);
    this.__kind = kind;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("section");
    element.className = "md-custom-block";
    element.setAttribute("data-block-kind", this.__kind);
    return element;
  }

  updateDOM(prevNode: CustomBlockNode, dom: HTMLElement): boolean {
    if (prevNode.__kind !== this.__kind) {
      dom.setAttribute("data-block-kind", this.__kind);
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("section");
    element.setAttribute("data-block-kind", this.__kind);
    return { element };
  }

  exportJSON(): SerializedCustomBlockNode {
    return { ...super.exportJSON(), type: "custom-block", version: 1, kind: this.__kind };
  }

  isInline(): boolean {
    return false;
  }

  getKind(): CustomBlockKind {
    return this.__kind;
  }
}

export function $isCustomBlockNode(node: LexicalNode | null | undefined): node is CustomBlockNode {
  return node instanceof CustomBlockNode;
}

export function $createCustomBlockNode(kind: CustomBlockKind = "aside"): CustomBlockNode {
  return $applyNodeReplacement(new CustomBlockNode(kind));
}
