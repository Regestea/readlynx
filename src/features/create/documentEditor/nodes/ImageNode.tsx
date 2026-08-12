/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
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
import { $getNodeByKey } from "lexical";
import { AlignCenter, AlignLeft, AlignRight, Trash2 } from "lucide-react";
import styles from "../DocumentEditor.module.css";

export type ImageAlign = "left" | "center" | "right" | null;

export interface ImagePayload {
  src: string;
  altText?: string;
  caption?: string;
  width?: number | null;
  height?: number | null;
  maxWidth?: number | null;
  align?: ImageAlign;
  round?: number | null;
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
  __height: number | null;
  __maxWidth: number | null;
  __align: ImageAlign;
  __round: number | null;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__caption,
      node.__width,
      node.__height,
      node.__maxWidth,
      node.__align,
      node.__round,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedLexicalNode & Record<string, unknown>): ImageNode {
    const { src, altText, caption, width, height, maxWidth, align, round } =
      serializedNode as unknown as SerializedImageNode;
    return $createImageNode({ src, altText, caption, width, height, maxWidth, align, round });
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
    height: number | null = null,
    maxWidth: number | null = null,
    align: ImageAlign = null,
    round: number | null = 0,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__caption = caption;
    this.__width = width;
    this.__height = height;
    this.__maxWidth = maxWidth;
    this.__align = align;
    this.__round = round;
  }

  exportJSON(): SerializedImageNode {
    return {
      type: "image",
      version: 1,
      src: this.__src,
      altText: this.__altText,
      caption: this.__caption,
      width: this.__width,
      height: this.__height,
      maxWidth: this.__maxWidth,
      align: this.__align,
      round: this.__round,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    if (this.__altText) element.setAttribute("alt", this.__altText);
    if (this.__width) element.setAttribute("width", String(this.__width));
    if (this.__height) element.setAttribute("height", String(this.__height));
    if (this.__round) element.style.borderRadius = `${this.__round}rem`;
    if (this.__align === "left") element.style.cssFloat = "left";
    else if (this.__align === "right") element.style.cssFloat = "right";
    else if (this.__align === "center") {
      element.style.display = "block";
      element.style.marginLeft = "auto";
      element.style.marginRight = "auto";
    }
    return { element };
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): false {
    return false;
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
        height={this.__height}
        maxWidth={this.__maxWidth}
        align={this.__align}
        round={this.__round}
      />
    );
  }

  isInline(): boolean {
    return true;
  }

  setWidth(width: number | null): void {
    this.getWritable().__width = width;
  }

  setHeight(height: number | null): void {
    this.getWritable().__height = height;
  }

  setAlign(align: ImageAlign): void {
    this.getWritable().__align = align;
  }

  setRound(round: number): void {
    this.getWritable().__round = round;
  }

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }

  getCaption(): string {
    return this.__caption;
  }
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

export function $createImageNode(payload: ImagePayload): ImageNode {
  const { src, altText, caption, width, height, maxWidth, align, round } = payload;
  return new ImageNode(
    src,
    altText ?? "",
    caption ?? "",
    width ?? null,
    height ?? null,
    maxWidth ?? null,
    align ?? null,
    round ?? 0,
  );
}

/* ---------- React rendering ---------- */

interface ImageComponentProps {
  nodeKey: NodeKey;
  src: string;
  altText: string;
  caption: string;
  width: number | null;
  height: number | null;
  maxWidth: number | null;
  align: ImageAlign;
  round: number | null;
}

interface MenuState {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ALIGN_OPTIONS: Array<{ value: ImageAlign; label: string; icon: typeof AlignLeft }> = [
  { value: "left", label: "Left", icon: AlignLeft },
  { value: "center", label: "Center", icon: AlignCenter },
  { value: "right", label: "Right", icon: AlignRight },
];

const SIZE_PRESETS: Array<{ label: string; width: number | null }> = [
  { label: "Small", width: 300 },
  { label: "Medium", width: 500 },
  { label: "Large", width: 800 },
  { label: "Full", width: null },
];

function ImageComponent({
  nodeKey,
  src,
  altText,
  caption,
  width,
  height,
  maxWidth,
  align,
  round,
}: ImageComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const commitAll = (changes: ImageMenuChanges) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof ImageNode) {
        node.setAlign(changes.align);
        node.setWidth(changes.width);
        node.setHeight(changes.height);
        node.setRound(changes.round);
      }
    });
    setMenu(null);
  };

  const deleteImage = () => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
    setMenu(null);
  };

  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const defaultW = Math.min(MAX_SIZE, Math.round(width ?? natural?.w ?? 300));
    const defaultH = Math.min(
      MAX_SIZE,
      Math.round(
        height ??
          (natural && natural.w > 0 ? (defaultW * natural.h) / natural.w : defaultW),
      ),
    );
    setMenu({
      x: event.clientX,
      y: event.clientY,
      width: defaultW,
      height: defaultH,
    });
  };

  const figureClasses = [styles.imageFigure].filter(Boolean).join(" ");

  const figureStyle: React.CSSProperties = {
    ...(align === "left" && { float: "left", margin: "0.25em 1em 0.25em 0" }),
    ...(align === "right" && { float: "right", margin: "0.25em 0 0.25em 1em" }),
    ...(align === "center" && {
      display: "block",
      width: "fit-content",
      marginLeft: "auto",
      marginRight: "auto",
    }),
  };

  return (
    <figure
      className={figureClasses}
      style={figureStyle}
      onClick={openMenu}
      onContextMenu={openMenu}
      data-lexical-image
    >
      <img
        src={src}
        alt={altText}
        className={styles.image}
        style={{
          width: width ? `${width}px` : "100%",
          height: height ? `${height}px` : undefined,
          maxWidth: maxWidth ?? "100%",
          borderRadius: round ? `${round}rem` : undefined,
        }}
        draggable={false}
        onLoad={(event) => {
          const el = event.currentTarget;
          if (el.naturalWidth > 0) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
        }}
      />
      {caption && <figcaption className={styles.imageCaption}>{caption}</figcaption>}
      {menu && (
        <ImageMenu
          x={menu.x}
          y={menu.y}
          width={menu.width}
          height={menu.height}
          align={align}
          round={round ?? 0}
          onApply={commitAll}
          onDelete={deleteImage}
          onClose={() => setMenu(null)}
        />
      )}
    </figure>
  );
}

/* ---------- Context menu ---------- */

interface ImageMenuChanges {
  align: ImageAlign;
  width: number | null;
  height: number | null;
  round: number;
}

interface ImageMenuProps {
  x: number;
  y: number;
  width: number;
  height: number;
  align: ImageAlign;
  round: number;
  onApply: (changes: ImageMenuChanges) => void;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 268;
const MENU_HEIGHT = 400;
const MIN_SIZE = 10;
const MAX_SIZE = 2000;

function clampSize(value: number): number {
  return Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, value)));
}

function clampRound(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function ImageMenu({
  x,
  y,
  width,
  height,
  align: initialAlign,
  round: initialRound,
  onApply,
  onDelete,
  onClose,
}: ImageMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<ImageAlign>(initialAlign);
  const [widthText, setWidthText] = useState<string>(String(width));
  const [heightText, setHeightText] = useState<string>(String(height));
  const [roundText, setRoundText] = useState<string>(String(initialRound));
  const [unsetSize, setUnsetSize] = useState<boolean>(false);
  const aspect = width > 0 && height > 0 ? width / height : 1;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const applyPreset = (presetWidth: number | null) => {
    if (presetWidth === null) {
      setWidthText(String(width));
      setHeightText(String(height));
      setUnsetSize(true);
      return;
    }
    const nextW = clampSize(presetWidth);
    const nextH = clampSize(Math.round(nextW / aspect));
    setWidthText(String(nextW));
    setHeightText(String(nextH));
    setUnsetSize(false);
  };

  const commitWidth = () => {
    const parsed = Number(widthText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setWidthText(String(width));
      return;
    }
    const nextW = clampSize(parsed);
    const nextH = clampSize(Math.round(nextW / aspect));
    setWidthText(String(nextW));
    setHeightText(String(nextH));
    setUnsetSize(false);
  };

  const commitHeight = () => {
    const parsed = Number(heightText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setHeightText(String(height));
      return;
    }
    const nextH = clampSize(parsed);
    const nextW = clampSize(Math.round(nextH * aspect));
    setHeightText(String(nextH));
    setWidthText(String(nextW));
    setUnsetSize(false);
  };

  const handleRoundChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRoundText(event.target.value);
  };

  const commitRoundText = () => {
    const parsed = Number(roundText);
    if (roundText === "" || !Number.isFinite(parsed)) {
      setRoundText(String(initialRound));
      return;
    }
    setRoundText(String(clampRound(parsed)));
  };

  const apply = () => {
    let nextWidth: number | null = null;
    let nextHeight: number | null = null;
    if (!unsetSize) {
      const parsedW = Number(widthText);
      const parsedH = Number(heightText);
      if (Number.isFinite(parsedW) && parsedW > 0 && Number.isFinite(parsedH) && parsedH > 0) {
        nextWidth = clampSize(parsedW);
        nextHeight = clampSize(parsedH);
      } else {
        setWidthText(String(width));
        setHeightText(String(height));
        nextWidth = width;
        nextHeight = height;
      }
    }
    const parsedRound = Number(roundText);
    const nextRound = Number.isFinite(parsedRound) ? clampRound(parsedRound) : initialRound;
    onApply({ align, width: nextWidth, height: nextHeight, round: nextRound });
  };

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8));

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={styles.imageMenu}
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.imageMenuSection}>
        <span className={styles.imageMenuLabel}>Align</span>
        <div className={styles.imageMenuRow}>
          {ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value ?? "none"}
              type="button"
              className={`${styles.imageMenuButton} ${align === value ? styles.imageMenuButtonActive : ""}`}
              title={label}
              aria-label={`Align ${label}`}
              aria-pressed={align === value}
              onClick={() => setAlign(value)}
            >
              <Icon size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.imageMenuSeparator} />

      <div className={styles.imageMenuSection}>
        <span className={styles.imageMenuLabel}>Size</span>
        <div className={styles.imageMenuRow}>
          {SIZE_PRESETS.map(({ label, width: presetWidth }) => (
            <button
              key={label}
              type="button"
              className={styles.imageMenuButton}
              onClick={() => applyPreset(presetWidth)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.imageMenuDims}>
          <label className={styles.imageMenuDim}>
            <span>Width</span>
            <input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={widthText}
              onChange={(event) => setWidthText(event.target.value)}
              onBlur={commitWidth}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <label className={styles.imageMenuDim}>
            <span>Height</span>
            <input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={heightText}
              onChange={(event) => setHeightText(event.target.value)}
              onBlur={commitHeight}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        </div>
        <span className={styles.imageMenuHint}>Up to {MAX_SIZE} × {MAX_SIZE} px</span>
      </div>

      <div className={styles.imageMenuSeparator} />

      <div className={styles.imageMenuSection}>
        <span className={styles.imageMenuLabel}>Rounded corners</span>
        <div className={styles.imageMenuRoundRow}>
          <input
            type="number"
            min={0}
            max={100}
            value={roundText}
            onChange={handleRoundChange}
            onBlur={commitRoundText}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <span className={styles.imageMenuRoundSuffix}>rem</span>
        </div>
      </div>

      <div className={styles.imageMenuSeparator} />

      <div className={styles.imageMenuFooter}>
        <button type="button" className={styles.imageMenuApply} onClick={apply}>
          Apply
        </button>
        <button type="button" className={styles.imageMenuDelete} onClick={onDelete}>
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
          Delete
        </button>
      </div>
    </div>,
    document.body,
  );
}
