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

/** `fill` is accepted for backward compatibility with older saved states. */
export type SerializedPageBreakNode = Spread<
  { type: "page-break"; page?: number; fill?: number; version: 1 },
  SerializedLexicalNode
>;

function $convertPageBreakElement(): { node: PageBreakNode } {
  return { node: $createPageBreakNode() };
}

/**
 * Manual page break.
 *
 * Pagination is pure CSS: the decorator root forces a hard page break via
 * `page-break-after: always` (visible only when printing), while its rendered
 * strip acts as a visual "page break" divider on screen. No measurement, no
 * reflow, no document mutation while typing.
 */
export class PageBreakNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return "page-break";
  }

  static clone(node: PageBreakNode): PageBreakNode {
    return new PageBreakNode(node.__key, node.__page);
  }

  static importJSON(serializedNode: SerializedPageBreakNode): PageBreakNode {
    const node = new PageBreakNode(undefined, serializedNode.page ?? null);
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

  constructor(key?: NodeKey, page?: number | null) {
    super(key);
    this.__page = page ?? null;
  }

  getPage(): number | null {
    return this.__page;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-page-break", "");
    element.setAttribute("contenteditable", "false");
    element.setAttribute("aria-hidden", "true");
    element.style.pageBreakAfter = "always";
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
    return <PageBreakComponent />;
  }
}

export function $isPageBreakNode(node: LexicalNode | null | undefined): node is PageBreakNode {
  return node instanceof PageBreakNode;
}

export function $createPageBreakNode(page?: number | null): PageBreakNode {
  return $applyNodeReplacement(new PageBreakNode(undefined, page));
}

function PageBreakComponent() {
  return (
    <div className={styles.pageBreak} contentEditable={false}>
      <div className={styles.pageBreakGap} data-page-gap="true">
        <span className={styles.pageBreakLabel}>Page break</span>
      </div>
    </div>
  );
}
