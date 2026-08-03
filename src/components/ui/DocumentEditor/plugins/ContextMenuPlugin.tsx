import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createRangeSelectionFromDom,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  $setTextFormat,
  COPY_COMMAND,
  CUT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  PASTE_COMMAND,
  REDO_COMMAND,
  SELECT_ALL_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
  type PasteCommandType,
  type TextFormatType,
} from "lexical";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import type { HistoryState } from "@lexical/history";
import { Check } from "lucide-react";
import type { BlockType } from "../types";
import { $createPageBreakNode } from "../nodes/PageBreakNode";
import styles from "../DocumentEditor.module.css";

interface ContextMenuPluginProps {
  paged?: boolean;
  historyState: HistoryState;
}

interface MenuSnapshot {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  highlight: boolean;
  code: boolean;
  isLink: boolean;
  hasSelection: boolean;
  blockType: BlockType;
  alignment: "left" | "center" | "right" | "justify";
  canUndo: boolean;
  canRedo: boolean;
}

interface MenuState {
  x: number;
  y: number;
  session: number;
  snapshot: MenuSnapshot;
}

function emptySnapshot(): MenuSnapshot {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    highlight: false,
    code: false,
    isLink: false,
    hasSelection: false,
    blockType: "paragraph",
    alignment: "left",
    canUndo: false,
    canRedo: false,
  };
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  if (typeof document.caretRangeFromPoint === "function") {
    return document.caretRangeFromPoint(x, y);
  }
  const position = document.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  return range;
}

/**
 * Moves the selection to the text under the right-click point (like Word),
 * unless the click landed inside an existing selection, which is kept so the
 * menu actions still apply to it.
 */
function moveCaretToPoint(editor: LexicalEditor, clientX: number, clientY: number): void {
  editor.update(() => {
    const rootEl = editor.getRootElement();
    const caretRange = caretRangeFromPoint(clientX, clientY);
    if (!rootEl || !caretRange || !caretRange.intersectsNode(rootEl)) return;

    const current = $getSelection();
    if ($isRangeSelection(current) && !current.isCollapsed()) {
      const domSelection = window.getSelection();
      const domRange = domSelection && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : null;
      if (
        domRange &&
        domRange.isPointInRange(caretRange.startContainer, caretRange.startOffset)
      ) {
        return;
      }
    }

    const domSelection = window.getSelection();
    if (!domSelection) return;
    /* `$createRangeSelectionFromDom` converts the current DOM selection, so
       point it at the click location first; the update commit re-syncs the
       DOM selection and focus from the resulting editor selection. */
    domSelection.removeAllRanges();
    domSelection.addRange(caretRange);
    const selection = $createRangeSelectionFromDom(domSelection, editor);
    if (selection) {
      $setSelection(selection);
    }
  });
}

function readSnapshot(editor: LexicalEditor, historyState: HistoryState): MenuSnapshot {
  const snapshot = emptySnapshot();
  snapshot.canUndo = historyState.undoStack.length > 0;
  snapshot.canRedo = historyState.redoStack.length > 0;

  editor.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    snapshot.bold = selection.hasFormat("bold");
    snapshot.italic = selection.hasFormat("italic");
    snapshot.underline = selection.hasFormat("underline");
    snapshot.strikethrough = selection.hasFormat("strikethrough");
    snapshot.highlight = selection.hasFormat("highlight");
    snapshot.code = selection.hasFormat("code");
    snapshot.hasSelection = !selection.isCollapsed();

    const anchorNode = selection.anchor.getNode();
    snapshot.isLink = $findMatchingParent(anchorNode, $isLinkNode) !== null;

    const top = anchorNode.getTopLevelElement() ?? anchorNode;
    const element = $isElementNode(top) ? top : null;
    if (!element) return;

    switch (element.getType()) {
      case "heading": {
        const tag = (element as unknown as { getTag?: () => string }).getTag?.();
        const level = /^h([1-6])$/.exec(tag ?? "");
        snapshot.blockType = level ? (`h${level[1]}` as BlockType) : "paragraph";
        break;
      }
      case "quote":
        snapshot.blockType = "quote";
        break;
      case "code":
        snapshot.blockType = "code";
        break;
      case "list": {
        const listType = (element as unknown as { getListType?: () => string }).getListType?.();
        snapshot.blockType =
          listType === "check" ? "check" : listType === "number" ? "ol" : "ul";
        break;
      }
      case "callout":
        snapshot.blockType = "callout";
        break;
      case "custom-block":
        snapshot.blockType = "custom";
        break;
      case "table":
        snapshot.blockType = "table";
        break;
      case "horizontalrule":
        snapshot.blockType = "hr";
        break;
      case "image":
        snapshot.blockType = "image";
        break;
    }

    const format = element.getFormat();
    if (format === 2) {
      snapshot.alignment = "center";
    } else if (format === 3) {
      snapshot.alignment = "right";
    } else if (format === 4) {
      snapshot.alignment = "justify";
    } else if (format === 1) {
      snapshot.alignment = "left";
    } else if (element.getDirection() === "rtl") {
      snapshot.alignment = "right";
    } else {
      snapshot.alignment = "left";
    }
  });

  return snapshot;
}

/* ---------- Menu rendering ---------- */

function Item({
  label,
  shortcut,
  checked,
  disabled,
  onSelect,
  close,
}: {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  close?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.menuItem}
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        close?.();
      }}
    >
      <span className={styles.menuItemIcon}>{checked ? <Check size={13} aria-hidden="true" /> : null}</span>
      <span className={styles.menuItemLabel}>{label}</span>
      {shortcut && <span className={styles.menuItemShortcut}>{shortcut}</span>}
    </button>
  );
}

interface ContextMenuPanelProps {
  x: number;
  y: number;
  session: number;
  paged: boolean;
  snapshot: MenuSnapshot;
  onClose: () => void;
}

function ContextMenuPanel({ x, y, session, paged, snapshot, onClose }: ContextMenuPanelProps) {
  const [editor] = useLexicalComposerContext();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, measured: false });
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  /* Clamp to the viewport once the real size is known. */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(pos.x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(pos.y, window.innerHeight - rect.height - 8));
    setPos((prev) =>
      prev.measured && prev.x === left && prev.y === top
        ? prev
        : { x: left, y: top, measured: true },
    );
  }, [pos.x, pos.y, session]);

  /* Focus the first enabled item when the menu opens. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [session]);

  /* Close on outside click, Escape, or scroll. */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (linkMode) {
        setLinkMode(false);
        menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
      } else {
        onClose();
      }
    };
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [linkMode, onClose]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = activeIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(items.length - 1, activeIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, activeIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const run = (action: () => void) => {
    action();
    onClose();
  };

  const toggleFormat = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const setBlock = (type: BlockType) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      switch (type) {
        case "paragraph":
          $setBlocksType(selection, () => $createParagraphNode());
          break;
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          $setBlocksType(selection, () => $createHeadingNode(type as HeadingTagType));
          break;
        case "quote":
          $setBlocksType(selection, () => $createQuoteNode());
          break;
        case "code":
          $setBlocksType(selection, () => $createCodeNode());
          break;
        case "ul":
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          break;
        case "ol":
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          break;
        case "check":
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
          break;
        default:
          break;
      }
    });
  };

  const setAlignment = (alignment: "left" | "center" | "right" | "justify") => {
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, alignment);
  };

  const insertPageBreak = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([$createPageBreakNode()]);
      }
    });
  };

  const insertHorizontalRule = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([$createHorizontalRuleNode()]);
      }
    });
  };

  const clearFormatting = () => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setTextFormat(selection, {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        highlight: false,
        code: false,
        superscript: false,
        subscript: false,
      });
      $patchStyleText(selection, {
        "font-family": null,
        "font-size": null,
        color: null,
        "background-color": null,
      });
    });
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      /* Route through PASTE_COMMAND so the markdown mapper and the rich-text
         paste pipeline behave exactly like Ctrl+V. */
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      editor.dispatchCommand(
        PASTE_COMMAND,
        {
          clipboardData: dataTransfer,
          dataTransfer,
          target: editor.getRootElement(),
          preventDefault: () => undefined,
        } as unknown as PasteCommandType,
      );
    } catch {
      /* clipboard not available */
    }
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    run(() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, url));
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Editor context menu"
      className={styles.contextMenu}
      style={{ left: pos.x, top: pos.y, visibility: pos.measured ? "visible" : "hidden" }}
      onKeyDown={handleMenuKeyDown}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Item label="Undo" shortcut="Ctrl+Z" disabled={!snapshot.canUndo} onSelect={() => run(() => editor.dispatchCommand(UNDO_COMMAND, undefined))} />
      <Item label="Redo" shortcut="Ctrl+Y" disabled={!snapshot.canRedo} onSelect={() => run(() => editor.dispatchCommand(REDO_COMMAND, undefined))} />
      <div className={styles.contextMenuSeparator} />
      <Item label="Cut" shortcut="Ctrl+X" disabled={!snapshot.hasSelection} onSelect={() => run(() => editor.dispatchCommand(CUT_COMMAND, null))} />
      <Item label="Copy" shortcut="Ctrl+C" disabled={!snapshot.hasSelection} onSelect={() => run(() => editor.dispatchCommand(COPY_COMMAND, null))} />
      <Item label="Paste" shortcut="Ctrl+V" onSelect={() => run(paste)} />
      <Item label="Select all" shortcut="Ctrl+A" onSelect={() => run(() => editor.dispatchCommand(SELECT_ALL_COMMAND, new KeyboardEvent("keydown")))} />
      <div className={styles.contextMenuSeparator} />
      <Item label="Bold" shortcut="Ctrl+B" checked={snapshot.bold} onSelect={() => run(() => toggleFormat("bold"))} />
      <Item label="Italic" shortcut="Ctrl+I" checked={snapshot.italic} onSelect={() => run(() => toggleFormat("italic"))} />
      <Item label="Underline" shortcut="Ctrl+U" checked={snapshot.underline} onSelect={() => run(() => toggleFormat("underline"))} />
      <Item label="Strikethrough" shortcut="Ctrl+Shift+S" checked={snapshot.strikethrough} onSelect={() => run(() => toggleFormat("strikethrough"))} />
      <Item label="Highlight" checked={snapshot.highlight} onSelect={() => run(() => toggleFormat("highlight"))} />
      <Item label="Inline code" shortcut="Ctrl+K" checked={snapshot.code} onSelect={() => run(() => toggleFormat("code"))} />
      <div className={styles.contextMenuSeparator} />
      {snapshot.isLink ? (
        <Item label="Remove link" onSelect={() => run(() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null))} />
      ) : linkMode ? (
        <div className={styles.contextMenuLinkRow}>
          <input
            type="url"
            className={styles.contextMenuLinkInput}
            placeholder="https://"
            aria-label="Link URL"
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              } else if (event.key === "Escape") {
                event.stopPropagation();
                setLinkMode(false);
              }
            }}
          />
        </div>
      ) : (
        <Item label="Add link…" onSelect={() => setLinkMode(true)} />
      )}
      <div className={styles.contextMenuSeparator} />
      <div className={styles.menuSection}>
        <span className={styles.menuSectionLabel}>Block</span>
        <Item label="Paragraph" checked={snapshot.blockType === "paragraph"} onSelect={() => run(() => setBlock("paragraph"))} />
        <Item label="Heading 1" checked={snapshot.blockType === "h1"} onSelect={() => run(() => setBlock("h1"))} />
        <Item label="Heading 2" checked={snapshot.blockType === "h2"} onSelect={() => run(() => setBlock("h2"))} />
        <Item label="Heading 3" checked={snapshot.blockType === "h3"} onSelect={() => run(() => setBlock("h3"))} />
        <Item label="Quote" checked={snapshot.blockType === "quote"} onSelect={() => run(() => setBlock("quote"))} />
        <Item label="Code block" checked={snapshot.blockType === "code"} onSelect={() => run(() => setBlock("code"))} />
        <Item label="Bulleted list" checked={snapshot.blockType === "ul"} onSelect={() => run(() => setBlock("ul"))} />
        <Item label="Numbered list" checked={snapshot.blockType === "ol"} onSelect={() => run(() => setBlock("ol"))} />
        <Item label="Checklist" checked={snapshot.blockType === "check"} onSelect={() => run(() => setBlock("check"))} />
      </div>
      <div className={styles.menuSection}>
        <span className={styles.menuSectionLabel}>Align</span>
        <Item label="Align left" checked={snapshot.alignment === "left"} onSelect={() => run(() => setAlignment("left"))} />
        <Item label="Align center" checked={snapshot.alignment === "center"} onSelect={() => run(() => setAlignment("center"))} />
        <Item label="Align right" checked={snapshot.alignment === "right"} onSelect={() => run(() => setAlignment("right"))} />
        <Item label="Justify" checked={snapshot.alignment === "justify"} onSelect={() => run(() => setAlignment("justify"))} />
      </div>
      <div className={styles.menuSection}>
        <span className={styles.menuSectionLabel}>Insert</span>
        {paged && <Item label="Page break" onSelect={() => run(insertPageBreak)} />}
        <Item label="Horizontal rule" onSelect={() => run(insertHorizontalRule)} />
      </div>
      <div className={styles.contextMenuSeparator} />
      <Item label="Clear formatting" onSelect={() => run(clearFormatting)} />
    </div>
  );
}

/* ---------- Plugin ---------- */

export function ContextMenuPlugin({ paged = false, historyState }: ContextMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      /* The image decorator renders its own context menu. */
      if (target.closest("[data-lexical-image]")) return;
      if (!editor.isEditable()) return;
      event.preventDefault();
      event.stopPropagation();

      moveCaretToPoint(editor, event.clientX, event.clientY);
      const snapshot = readSnapshot(editor, historyState);
      setMenu((prev) => ({
        x: event.clientX,
        y: event.clientY,
        session: (prev?.session ?? 0) + 1,
        snapshot,
      }));
    };

    return editor.registerRootListener((rootElement) => {
      if (rootElement === null) return;
      rootElement.addEventListener("contextmenu", handleContextMenu);
      return () => rootElement.removeEventListener("contextmenu", handleContextMenu);
    });
  }, [editor, historyState]);

  if (menu === null) return null;

  return createPortal(
    <ContextMenuPanel
      key={menu.session}
      x={menu.x}
      y={menu.y}
      session={menu.session}
      paged={paged}
      snapshot={menu.snapshot}
      onClose={() => setMenu(null)}
    />,
    document.body,
  );
}
