/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import type { JSX } from "react";
import type {
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $applyNodeReplacement, $getNodeByKey, DecoratorNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import katex from "katex";
import "katex/dist/katex.min.css";
import styles from "../DocumentEditor.module.css";

export type SerializedEquationNode = Spread<
  { equation: string; inline: boolean; version: 1 },
  SerializedLexicalNode
>;

function $convertEquationElement(element: HTMLElement) {
  const equation = element.getAttribute("data-equation") ?? "";
  const inline = element.getAttribute("data-equation-inline") === "true";
  if (!equation) return null;
  return { node: $createEquationNode(equation, inline) };
}

/**
 * KaTeX equation. `inline=true` renders as inline math, `inline=false` as a
 * centered display equation. Rendered with real KaTeX in the editor and
 * exported as KaTeX HTML markup so PDF/HTML/EPUB take the math along.
 */
export class EquationNode extends DecoratorNode<JSX.Element> {
  __equation: string;
  __inline: boolean;

  static getType(): string {
    return "equation";
  }

  static clone(node: EquationNode): EquationNode {
    return new EquationNode(node.__equation, node.__inline, node.__key);
  }

  static importJSON(serializedNode: SerializedEquationNode): EquationNode {
    return $createEquationNode(serializedNode.equation, serializedNode.inline);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (element) => {
        const equation = element.getAttribute("data-equation");
        if (equation === null) return null;
        return { conversion: $convertEquationElement, priority: 0 };
      },
    };
  }

  constructor(equation: string, inline = false, key?: NodeKey) {
    super(key);
    this.__equation = equation;
    this.__inline = inline;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__inline ? "span" : "div");
    element.setAttribute("data-equation", this.__equation);
    element.setAttribute("data-equation-inline", String(this.__inline));
    element.className = this.__inline ? styles.equationInline : styles.equationBlock;
    return element;
  }

  updateDOM(prevNode: EquationNode, dom: HTMLElement): boolean {
    if (prevNode.__equation !== this.__equation) {
      dom.setAttribute("data-equation", this.__equation);
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.__inline ? "span" : "div");
    element.setAttribute("data-equation", this.__equation);
    element.setAttribute("data-equation-inline", String(this.__inline));
    try {
      element.innerHTML = katex.renderToString(this.__equation, {
        displayMode: !this.__inline,
        throwOnError: false,
      });
    } catch {
      element.textContent = this.__equation;
    }
    return { element };
  }

  exportJSON(): SerializedEquationNode {
    return {
      ...super.exportJSON(),
      type: "equation",
      version: 1,
      equation: this.__equation,
      inline: this.__inline,
    };
  }

  getTextContent(): string {
    return this.__equation;
  }

  isInline(): boolean {
    return this.__inline;
  }

  isEquation(): boolean {
    return true;
  }

  getEquation(): string {
    return this.__equation;
  }

  setEquation(equation: string): void {
    this.getWritable().__equation = equation;
  }

  decorate(): JSX.Element {
    return (
      <EquationComponent
        nodeKey={this.getKey()}
        equation={this.__equation}
        inline={this.__inline}
      />
    );
  }
}

export function $isEquationNode(node: LexicalNode | null | undefined): node is EquationNode {
  return node instanceof EquationNode;
}

export function $createEquationNode(equation: string, inline = false): EquationNode {
  return $applyNodeReplacement(new EquationNode(equation, inline));
}

/* ---------- React rendering ---------- */

function katexHtml(equation: string, displayMode: boolean): string {
  try {
    return katex.renderToString(equation, { displayMode, throwOnError: false });
  } catch {
    return equation.replace(/</g, "&lt;");
  }
}

interface EquationComponentProps {
  nodeKey: NodeKey;
  equation: string;
  inline: boolean;
}

function EquationComponent({ nodeKey, equation, inline }: EquationComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(equation);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === equation) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof EquationNode) {
        node.setEquation(next);
      }
    });
  };

  if (editing) {
    return (
      <input
        className={styles.equationEdit}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setEditing(false);
        }}
        aria-label="Equation"
        autoFocus
      />
    );
  }

  const html = katexHtml(equation, !inline);
  return (
    <span
      className={inline ? styles.equationRendererInline : styles.equationRendererBlock}
      title="Click to edit equation"
      onDoubleClick={() => {
        setDraft(equation);
        setEditing(true);
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}