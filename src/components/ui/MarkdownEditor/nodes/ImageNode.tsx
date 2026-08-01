/* eslint-disable react-refresh/only-export-components */
import type { JSX } from "react";
import type {
  DOMConversionMap,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { DecoratorNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { $getNodeByKey } from "lexical";
import styles from "../MarkdownEditor.module.css";

export interface ImagePayload {
  src: string;
  altText?: string;
  caption?: string;
  width?: number | null;
  maxWidth?: number | null;
}

export type SerializedImageNode = Spread<
  ImagePayload,
  { type: "image"; version: 1 }
>;

function $convertImageElement(element: HTMLElement) {
  const imageElement = element as HTMLImageElement;
  const src = imageElement.getAttribute("src") ?? "";
  if (!src) return null;
  return {
    node: $createImageNode({
      src,
      altText: imageElement.getAttribute("alt") ?? "",
      width: imageElement.width > 0 ? imageElement.width : null,
    }),
  };
}

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;
  __caption: string;
  __width: number | null;
  __maxWidth: number | null;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__caption,
      node.__width,
      node.__maxWidth,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedLexicalNode & Record<string, unknown>): ImageNode {
    const { src, altText, caption, width, maxWidth } = serializedNode as unknown as SerializedImageNode;
    return $createImageNode({ src, altText, caption, width, maxWidth });
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({ conversion: $convertImageElement, priority: 0 }),
    };
  }

  constructor(
    src: string,
    altText = "",
    caption = "",
    width: number | null = null,
    maxWidth: number | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__caption = caption;
    this.__width = width;
    this.__maxWidth = maxWidth;
  }

  exportJSON(): SerializedImageNode {
    return {
      type: "image",
      version: 1,
      src: this.__src,
      altText: this.__altText,
      caption: this.__caption,
      width: this.__width,
      maxWidth: this.__maxWidth,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    if (this.__altText) element.setAttribute("alt", this.__altText);
    if (this.__width) element.setAttribute("width", String(this.__width));
    return { element };
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  getTextContent(): string {
    return this.__altText;
  }

  decorate(): JSX.Element {
    return (
      <ImageComponent
        nodeKey={this.getKey()}
        src={this.__src}
        altText={this.__altText}
        caption={this.__caption}
        width={this.__width}
        maxWidth={this.__maxWidth}
      />
    );
  }

  isInline(): boolean {
    return true;
  }

  setWidth(width: number | null): void {
    this.getWritable().__width = width;
  }

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

export function $createImageNode(payload: ImagePayload): ImageNode {
  const { src, altText, caption, width, maxWidth } = payload;
  return new ImageNode(src, altText ?? "", caption ?? "", width ?? null, maxWidth ?? null);
}

/* ---------- React rendering ---------- */

interface ImageComponentProps {
  nodeKey: NodeKey;
  src: string;
  altText: string;
  caption: string;
  width: number | null;
  maxWidth: number | null;
}

function ImageComponent({ nodeKey, src, altText, caption, width, maxWidth }: ImageComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected] = useLexicalNodeSelection(nodeKey);

  const commitWidth = (nextWidth: number) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof ImageNode) node.setWidth(nextWidth);
    });
  };

  const onResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width ?? 300;
    const containerWidth = (event.currentTarget.parentElement?.getBoundingClientRect().width ?? 600) - 32;

    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(containerWidth, Math.max(60, startWidth + (moveEvent.clientX - startX)));
      commitWidth(Math.round(next));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <figure
      className={`${styles.imageFigure} ${isSelected ? styles.imageSelected : ""}`}
      onClick={(event) => {
        event.preventDefault();
        setSelected(!isSelected);
      }}
      draggable={false}
    >
      <img
        src={src}
        alt={altText}
        className={styles.image}
        style={{ width: width ? `${width}px` : "100%", maxWidth: maxWidth ?? "100%" }}
        draggable={false}
      />
      {isSelected && (
        <button
          className={styles.imageResizeHandle}
          aria-label="Resize image"
          onMouseDown={onResizeStart}
        />
      )}
      {caption && <figcaption className={styles.imageCaption}>{caption}</figcaption>}
    </figure>
  );
}
