/* eslint-disable react-refresh/only-export-components */
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
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import styles from "../DocumentEditor.module.css";

export type SerializedPageBreakNode = Spread<
  { type: "page-break"; page?: number; fill?: number; version: 1 },
  SerializedLexicalNode
>;

function $convertPageBreakElement(): { node: PageBreakNode } {
  return { node: $createPageBreakNode() };
}

export class PageBreakNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return "page-break";
  }

  static clone(node: PageBreakNode): PageBreakNode {
    return new PageBreakNode(node.__key, node.__page, node.__fill);
  }

  static importJSON(serializedNode: SerializedPageBreakNode): PageBreakNode {
    const node = new PageBreakNode(
      undefined,
      serializedNode.page ?? null,
      serializedNode.fill ?? 0,
    );
    return node.updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (node) => {
        if (node instanceof HTMLDivElement && node.hasAttribute("data-page-break")) {
          return { conversion: $convertPageBreakElement, priority: 1 };
        }
        return null;
      },
    };
  }

  __page: number | null;
  __fill: number;

  constructor(key?: NodeKey, page?: number | null, fill?: number) {
    super(key);
    this.__page = page ?? null;
    this.__fill = fill ?? 0;
  }

  getPage(): number | null {
    return this.__page;
  }

  getFill(): number {
    return this.__fill;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-page-break", "");
    element.setAttribute("contenteditable", "false");
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.setAttribute("data-page-break", "");
    element.style.pageBreakAfter = "always";
    return { element };
  }

  exportJSON(): SerializedPageBreakNode {
    return {
      ...super.exportJSON(),
      type: "page-break",
      page: this.__page ?? undefined,
      fill: this.__fill > 0 ? this.__fill : undefined,
      version: 1,
    };
  }

  getTextContent(): string {
    return "";
  }

  isInline(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return <PageBreakComponent page={this.__page} fill={this.__fill} />;
  }
}

export function $isPageBreakNode(node: LexicalNode | null | undefined): node is PageBreakNode {
  return node instanceof PageBreakNode;
}

export function $createPageBreakNode(page?: number | null, fill?: number): PageBreakNode {
  return $applyNodeReplacement(new PageBreakNode(undefined, page, fill));
}

function PageBreakComponent({ page, fill }: { page: number | null; fill: number }) {
  return (
    <div className={styles.pageBreak} contentEditable={false}>
      {fill > 0 && (
        <div className={styles.pageBreakFill} style={{ height: fill }} aria-hidden="true" />
      )}
      <div className={styles.pageBreakGap} data-page-gap="true">
        <span className={styles.pageBreakLabel}>
          {page != null ? `Page ${page}` : "•"}
        </span>
      </div>
    </div>
  );
}
