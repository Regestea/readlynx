import { useEffect, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { CodeHighlightNode, CodeNode, registerCodeHighlighting } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { createEmptyHistoryState } from "@lexical/history";
import type { HistoryState } from "@lexical/history";
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  REDO_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type TextNode,
} from "lexical";
import { $isLinkNode } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import { $getSelectionStyleValueForProperty } from "@lexical/selection";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { mdTransformers } from "./plugins/MarkdownPlugin";
import { AutoFocusPlugin } from "./plugins/AutoFocusPlugin";
import { DraggableImagePlugin } from "./plugins/DraggableImagePlugin";
import { MarkdownPlugin } from "./plugins/MarkdownPlugin";
import { ShortcutsPlugin } from "./plugins/ShortcutsPlugin";
import { exportEpub } from "./exporters/epubExporter";
import { exportHtml } from "./exporters/htmlExporter";
import { createEditorTheme } from "./theme";
import { CalloutNode } from "./nodes/CalloutNode";
import { CustomBlockNode } from "./nodes/CustomBlockNode";
import { ImageNode } from "./nodes/ImageNode";
import { EditorApiContext, ToolbarStateContext } from "./context";
import {
  EMPTY_TOOLBAR_STATE,
  type BlockType,
  type EditorAPI,
  type EpubMetadata,
  type ToolbarState,
} from "./types";

interface EditorProviderProps {
  children: ReactNode;
  initialMarkdown?: string;
  initialState?: string | null;
  editable?: boolean;
  onSave?: () => void;
  apiRef?: RefObject<EditorAPI | null>;
}

/* ---------- Toolbar state sync ---------- */

function getSelectedNode(selection: ReturnType<typeof $getSelection>): TextNode | ElementNode {
  if (!selection || !$isRangeSelection(selection)) return $getRoot();
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  if (anchorNode === focusNode) return anchorNode;
  if (selection.isBackward()) {
    return $isElementNode(anchorNode) ? anchorNode : (anchorNode.getParentOrThrow() as ElementNode);
  }
  return $isElementNode(focusNode) ? focusNode : (focusNode.getParentOrThrow() as ElementNode);
}

function computeToolbarState(canUndo: boolean, canRedo: boolean): ToolbarState {
  const selection = $getSelection();
  const state: ToolbarState = { ...EMPTY_TOOLBAR_STATE, canUndo, canRedo };
  if (!$isRangeSelection(selection)) return state;

  const node = getSelectedNode(selection);
  const anchorNode = selection.anchor.getNode();
  const element: ElementNode | null =
    anchorNode.getKey() === "root"
      ? (anchorNode as ElementNode)
      : (($findMatchingParent(anchorNode, (e) => {
          const parent = e.getParent();
          return parent !== null && $isRootNode(parent);
        }) ?? anchorNode.getTopLevelElement()) as ElementNode | null);
  if (element) {
    if ($isRootNode(element)) {
      state.blockType = "paragraph";
    } else {
      const type = element.getType();
      state.blockType = mapTypeToBlockType(type, element);
    }
  }

  state.bold = selection.hasFormat("bold");
  state.italic = selection.hasFormat("italic");
  state.underline = selection.hasFormat("underline");
  state.strikethrough = selection.hasFormat("strikethrough");
  state.highlight = selection.hasFormat("highlight");
  state.superscript = selection.hasFormat("superscript");
  state.subscript = selection.hasFormat("subscript");
  state.code = selection.hasFormat("code");

  state.fontFamily = $getSelectionStyleValueForProperty(selection, "font-family", "");
  state.fontSize = $getSelectionStyleValueForProperty(selection, "font-size", "");
  state.textColor = $getSelectionStyleValueForProperty(selection, "color", "");
  state.bgColor = $getSelectionStyleValueForProperty(selection, "background-color", "");

  const linkParent = $findMatchingParent(node as ElementNode, $isLinkNode);
  state.isLink = linkParent !== null;

  return state;
}

function mapTypeToBlockType(type: string, element: ElementNode): BlockType {
  switch (type) {
    case "heading": {
      const tag = (element as unknown as { getTag?: () => string }).getTag?.();
      const level = /^h([1-6])$/.exec(tag ?? "");
      return level ? (`h${level[1]}` as BlockType) : "paragraph";
    }
    case "quote":
      return "quote";
    case "code":
      return "code";
    case "list": {
      const listType = (element as unknown as { getListType?: () => string }).getListType?.();
      if (listType === "check") return "check";
      if (listType === "number") return "ol";
      return "ul";
    }
    case "callout":
      return "callout";
    case "custom-block":
      return "custom";
    case "table":
      return "table";
    case "horizontalrule":
      return "hr";
    case "image":
      return "image";
    default:
      return "paragraph";
  }
}

/* ---------- Internal wiring ---------- */

function EditorApiBridge({
  children,
  apiRef,
  historyState,
}: {
  children: ReactNode;
  apiRef?: RefObject<EditorAPI | null>;
  historyState: HistoryState;
}) {
  const [editor] = useLexicalComposerContext();
  const [toolbarState, setToolbarState] = useState<ToolbarState>(EMPTY_TOOLBAR_STATE);

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        setToolbarState(
          computeToolbarState(
            historyState.undoStack.length > 0,
            historyState.redoStack.length > 0,
          ),
        );
      });
    });
  }, [editor, historyState]);

  const api = useMemo<EditorAPI>(
    () => ({
      saveState: () => JSON.stringify(editor.getEditorState().toJSON()),
      loadState: (json: string) => {
        editor.setEditorState(editor.parseEditorState(json));
      },
      newDocument: () => {
        editor.update(() => $getRoot().clear());
      },
      importMarkdown: (markdown: string) => {
        editor.update(() => $convertFromMarkdownString(markdown, mdTransformers));
      },
      exportMarkdown: () =>
        editor.getEditorState().read(() => $convertToMarkdownString(mdTransformers)),
      exportHtml: () => exportHtml(editor),
      exportEpub: (metadata?: EpubMetadata) => exportEpub(editor, metadata),
      undo: () => editor.dispatchCommand(UNDO_COMMAND, undefined),
      redo: () => editor.dispatchCommand(REDO_COMMAND, undefined),
      focus: () => editor.focus(),
      getEditor: () => editor,
    }),
    [editor],
  );

  useEffect(() => {
    if (apiRef) apiRef.current = api;
  }, [api, apiRef]);

  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);

  return (
    <EditorApiContext.Provider value={api}>
      <ToolbarStateContext.Provider value={toolbarState}>{children}</ToolbarStateContext.Provider>
    </EditorApiContext.Provider>
  );
}

/* ---------- Public component ---------- */

export function EditorProvider({
  children,
  initialMarkdown,
  initialState,
  editable = true,
  onSave,
  apiRef,
}: EditorProviderProps) {
  const config: InitialConfigType = useMemo(
    () => ({
      namespace: "readlynx-document-editor",
      editable,
      theme: createEditorTheme(),
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        CodeHighlightNode,
        TableNode,
        TableRowNode,
        TableCellNode,
        LinkNode,
        HorizontalRuleNode,
        ImageNode,
        CalloutNode,
        CustomBlockNode,
      ],
      onError: (error) => {
        console.error(error);
      },
    }),
    [editable],
  );

  return (
    <LexicalComposer initialConfig={config}>
      <EditorCore initialMarkdown={initialMarkdown} initialState={initialState} onSave={onSave} apiRef={apiRef}>
        {children}
      </EditorCore>
    </LexicalComposer>
  );
}

function EditorCore({
  children,
  initialMarkdown,
  initialState,
  apiRef,
  onSave,
}: {
  children: ReactNode;
  initialMarkdown?: string;
  initialState?: string | null;
  apiRef?: RefObject<EditorAPI | null>;
  onSave?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [historyState] = useState(() => createEmptyHistoryState());

  useEffect(() => {
    if (initialState) {
      editor.setEditorState(editor.parseEditorState(initialState));
    } else if (initialMarkdown) {
      editor.update(() => {
        $getRoot().clear();
        $convertFromMarkdownString(initialMarkdown, mdTransformers);
      });
    }
  }, [editor, initialMarkdown, initialState]);

  return (
    <>
      <HistoryPlugin externalHistoryState={historyState} />
      <LinkPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <TablePlugin />
      <MarkdownPlugin shortcuts />
      <ShortcutsPlugin onSave={onSave} />
      <DraggableImagePlugin />
      <AutoFocusPlugin />
      <EditorApiBridge apiRef={apiRef} historyState={historyState}>
        {children}
      </EditorApiBridge>
    </>
  );
}
