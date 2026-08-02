import type { EditorConfig, NodeKey, SerializedTextNode, Spread } from "lexical";
import { $applyNodeReplacement, TextNode } from "lexical";
import styles from "../DocumentEditor.module.css";

export type SerializedSearchHighlightNode = Spread<
  { type: "search-highlight"; version: 1 },
  SerializedTextNode
>;

export class SearchHighlightNode extends TextNode {
  static getType(): string {
    return "search-highlight";
  }

  static clone(node: SearchHighlightNode): SearchHighlightNode {
    return new SearchHighlightNode(node.__text, node.__key);
  }

  static importJSON(serializedNode: SerializedSearchHighlightNode): SearchHighlightNode {
    const node = new SearchHighlightNode(serializedNode.text);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  constructor(text: string, key?: NodeKey) {
    super(text, key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.classList.add(styles.searchHighlight);
    return element;
  }

  isSimpleText(): boolean {
    return false;
  }

  exportJSON(): SerializedSearchHighlightNode {
    return {
      ...super.exportJSON(),
      type: "search-highlight",
      version: 1,
    };
  }
}

export function $isSearchHighlightNode(node: unknown): node is SearchHighlightNode {
  return node instanceof SearchHighlightNode;
}

export function $createSearchHighlightNode(text: string): SearchHighlightNode {
  return $applyNodeReplacement(new SearchHighlightNode(text));
}
