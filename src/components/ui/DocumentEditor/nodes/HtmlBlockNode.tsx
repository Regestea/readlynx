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
import styles from "../DocumentEditor.module.css";

export type SerializedHtmlBlockNode = Spread<
  { html: string; version: 1 },
  SerializedLexicalNode
>;

function $convertHtmlBlockElement(element: HTMLElement) {
  const html = element.getAttribute("data-rl-html") ?? "";
  if (!html) return null;
  return { node: $createHtmlBlockNode(html) };
}

/** Strips scripts and event-handler attributes from pasted raw HTML. */
export function sanitizeHtmlBlock(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

/**
 * Raw HTML block, e.g. a `<div>` with inline styles pasted from a Markdown
 * document. Stored verbatim, previewed read-only in the editor, and exported
 * as-is into HTML/PDF/EPUB so nothing is lost on the way out.
 */
export class HtmlBlockNode extends DecoratorNode<JSX.Element> {
  __html: string;

  static getType(): string {
    return "html-block";
  }

  static clone(node: HtmlBlockNode): HtmlBlockNode {
    return new HtmlBlockNode(node.__html, node.__key);
  }

  static importJSON(serializedNode: SerializedHtmlBlockNode): HtmlBlockNode {
    return $createHtmlBlockNode(serializedNode.html);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (element) => {
        if (element.hasAttribute("data-rl-html")) {
          return { conversion: $convertHtmlBlockElement, priority: 1 };
        }
        return null;
      },
    };
  }

  constructor(html: string, key?: NodeKey) {
    super(key);
    this.__html = html;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-rl-html", this.__html);
    element.setAttribute("contenteditable", "false");
    element.className = styles.htmlBlock;
    return element;
  }

  updateDOM(prevNode: HtmlBlockNode, dom: HTMLElement): boolean {
    if (prevNode.__html !== this.__html) {
      dom.setAttribute("data-rl-html", this.__html);
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.setAttribute("data-rl-html", this.__html);
    element.innerHTML = this.__html;
    return { element };
  }

  exportJSON(): SerializedHtmlBlockNode {
    return { ...super.exportJSON(), type: "html-block", version: 1, html: this.__html };
  }

  getTextContent(): string {
    return this.__html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  isInline(): boolean {
    return false;
  }

  getHtml(): string {
    return this.__html;
  }

  setHtml(html: string): void {
    this.getWritable().__html = html;
  }

  decorate(): JSX.Element {
    return <HtmlBlockComponent nodeKey={this.getKey()} html={this.__html} />;
  }
}

export function $isHtmlBlockNode(node: LexicalNode | null | undefined): node is HtmlBlockNode {
  return node instanceof HtmlBlockNode;
}

export function $createHtmlBlockNode(html: string): HtmlBlockNode {
  return $applyNodeReplacement(new HtmlBlockNode(html));
}

/* ---------- React rendering ---------- */

interface HtmlBlockComponentProps {
  nodeKey: NodeKey;
  html: string;
}

function HtmlBlockComponent({ nodeKey, html }: HtmlBlockComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(html);

  const commit = () => {
    const next = sanitizeHtmlBlock(draft).trim();
    setEditing(false);
    if (!next || next === html) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof HtmlBlockNode) {
        node.setHtml(next);
      }
    });
  };

  if (editing) {
    return (
      <div className={styles.htmlBlockEditWrap}>
        <textarea
          className={styles.htmlBlockEdit}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
          }}
          aria-label="Raw HTML"
          autoFocus
          spellCheck={false}
        />
        <span className={styles.htmlBlockHint}>Ctrl/⌘ + Enter to apply</span>
      </div>
    );
  }

  return (
    <div
      className={styles.htmlBlockPreview}
      contentEditable={false}
      title="Double-click to edit raw HTML"
      onDoubleClick={() => {
        setDraft(html);
        setEditing(true);
      }}
    >
      <span className={styles.htmlBlockBadge}>HTML</span>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}