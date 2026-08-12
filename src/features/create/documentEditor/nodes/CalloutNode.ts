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
import type { CalloutTone } from "../types";

export type SerializedCalloutNode = Spread<
  { tone: CalloutTone; label?: string; version: 1 },
  SerializedElementNode
>;

function $convertCalloutElement(element: HTMLElement) {
  const tone = (element.getAttribute("data-callout-tone") as CalloutTone | null) ?? "info";
  const label = element.getAttribute("data-callout-label") ?? "";
  return { node: $createCalloutNode(tone, label || undefined) };
}

export class CalloutNode extends ElementNode {
  __tone: CalloutTone;
  __label: string;

  static getType(): string {
    return "callout";
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__tone, node.__label, node.__key);
  }

  static importJSON(serializedNode: SerializedCalloutNode): CalloutNode {
    return $createCalloutNode(serializedNode.tone, serializedNode.label).updateFromJSON(
      serializedNode,
    );
  }

  static importDOM(): DOMConversionMap | null {
    return {
      aside: () => ({ conversion: $convertCalloutElement, priority: 0 }),
    };
  }

  constructor(tone: CalloutTone = "info", label = "", key?: NodeKey) {
    super(key);
    this.__tone = tone;
    this.__label = label;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("aside");
    element.className = "md-callout";
    element.setAttribute("data-callout-tone", this.__tone);
    element.setAttribute("data-callout-label", this.__label);
    return element;
  }

  updateDOM(prevNode: CalloutNode, dom: HTMLElement): boolean {
    if (prevNode.__tone !== this.__tone) {
      dom.setAttribute("data-callout-tone", this.__tone);
    }
    if (prevNode.__label !== this.__label) {
      dom.setAttribute("data-callout-label", this.__label);
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("aside");
    element.setAttribute("data-callout-tone", this.__tone);
    if (this.__label) element.setAttribute("data-callout-label", this.__label);
    return { element };
  }

  exportJSON(): SerializedCalloutNode {
    return {
      ...super.exportJSON(),
      type: "callout",
      version: 1,
      tone: this.__tone,
      ...(this.__label ? { label: this.__label } : {}),
    };
  }

  isInline(): boolean {
    return false;
  }

  getTone(): CalloutTone {
    return this.__tone;
  }

  setTone(tone: CalloutTone): void {
    this.getWritable().__tone = tone;
  }

  getLabel(): string {
    return this.__label || this.__tone;
  }
}

export function $isCalloutNode(node: LexicalNode | null | undefined): node is CalloutNode {
  return node instanceof CalloutNode;
}

export function $createCalloutNode(tone: CalloutTone = "info", label?: string): CalloutNode {
  return $applyNodeReplacement(new CalloutNode(tone, label ?? ""));
}
