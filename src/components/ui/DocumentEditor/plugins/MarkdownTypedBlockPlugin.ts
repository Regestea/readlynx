import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  KEY_ENTER_COMMAND,
  $addUpdateTag,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  type LexicalNode,
} from "lexical";
import { $generateNodesFromMarkdownString } from "@lexical/markdown";
import { $exportMarkdownString, mdTransformers } from "./MarkdownPlugin";
import { $isImageNode } from "../nodes/ImageNode";

/**
 * Typing the block-level Markdown constructs that `@lexical/markdown` only
 * converts on paste (display equations `$$…$$`, raw HTML blocks, tables,
 * callouts, images, …) used to leave them as raw text. Lexical's built-in
 * shortcuts only fire inline/single-line transformers as you type.
 *
 * This plugin listens for Enter at the end of a paragraph. When the text of
 * the current (and the directly preceding) plain paragraphs parses back into
 * exactly one block node that round-trips to the same Markdown, it replaces
 * those paragraphs with that node — effectively "typing then Enter" behaves
 * like pasting the same Markdown.
 */

const MAX_GATHER_LINES = 40;

/** Void HTML elements that are valid without a closing tag. */
const VOID_TAGS = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
];

/**
 * A typed raw-HTML block must look complete before we convert it, otherwise
 * pressing Enter after the opening line (`<div>`) would freeze the block and
 * the user could never add the closing `</div>`. A block is complete when it
 * contains a matching closing tag for its opening tag name, a self-closing
 * (`/>`) first element, a void element, or a closed comment.
 */
function isCompleteHtmlBlock(html: string): boolean {
  const trimmed = html.trim();
  // Comment block (`<!-- … -->`) — complete once closed.
  if (trimmed.startsWith("<!--")) return /-->/.test(html);
  const matcher = trimmed.match(/^<([a-zA-Z][\w:-]*)\b/);
  if (!matcher) return false;
  const tag = matcher[1].toLowerCase();
  if (VOID_TAGS.indexOf(tag) !== -1) return true;
  if (/\/\s*>/.test(html)) return true; // self-closing
  return new RegExp(`</[ \\t]*${tag}[ \\t]*>`, "i").test(html);
}

/** True when the markdown table source contains at least one data row after
 *  the divider (i.e. more than header + divider lines). */
function hasAtLeastOneBodyRow(source: string): boolean {
  const lines = source.split(/\r?\n/).map((line) => line.trim());
  // Find the first divider row; there must be a non-divider line after it.
  for (let i = 0; i < lines.length; i++) {
    if (isTableDividerLine(lines[i])) {
      return lines.slice(i + 1).some((line) => line !== "");
    }
  }
  return false;
}

function isTableDividerLine(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line) && /^-{3,}/.test(line) && line.includes("|");
}

/** Compares source and export ignoring leading/trailing whitespace per line. */
function normalizeForCompare(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n");
}

/**
 * Display equations export as a three-line form (`$$\n…\n$$`), so a single
 * line typed as `$$…$$` must compare against the multi-line export.
 */
function exportCompareSource(type: string, source: string): string {
  if (type === "callout") {
    const stripQuote = (text: string) =>
      text
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s{0,3}>\s?/, ""))
        .join(" ");
    return stripQuote(normalizeForCompare(source));
  }
  if (type !== "equation") return normalizeForCompare(source);
  const lines = source.split(/\r?\n/).map((line) => line.trim());
  if (lines.length === 1) {
    const single = lines[0];
    if (single.startsWith("$$") && single.endsWith("$$") && single.length > 4) {
      const inner = single.slice(2, -2).trim();
      if (inner && !/\r?\n/.test(inner)) {
        return normalizeForCompare(`$$\n${inner}\n$$`);
      }
    }
  }
  if (lines.length >= 1 && lines[0] === "$$" && lines[lines.length - 1] === "$$") {
    return normalizeForCompare(lines.join("\n"));
  }
  return normalizeForCompare(source);
}

/**
 * Parses `source` and returns a single block node when the text is entirely
 * consumed by exactly one non-paragraph block that re-exports to the same
 * Markdown (round-trip). Returns null for plain text or ambiguous input.
 */
function $parseSingleBlock(source: string): LexicalNode | null {
  const nodes = $generateNodesFromMarkdownString(source, mdTransformers);
  if (nodes.length !== 1) return null;
  const node = nodes[0];
  if ($isParagraphNode(node)) {
    // A bare image line parses to a paragraph holding only inline image
    // decorators. That is still a conversion (the raw `![alt](src)` text
    // disappears), so keep the paragraph itself.
    const children = node.getChildren();
    if (children.length === 0 || children.some((child) => !$isImageNode(child))) {
      return null;
    }
  }

  const type = node.getType();
  // Empty-output blocks only count when they are a by-design marker or a bare
  // HTML wrapper (`<div></div>` has no text content to size-check).
  if (
    node.getTextContentSize() === 0 &&
    type !== "horizontalrule" &&
    type !== "image" &&
    type !== "html-block"
  ) {
    return null;
  }
  // Never prematurely convert an unclosed raw-HTML block the user is still
  // typing (e.g. just `<div>` on its own line with more lines to come).
  if (type === "html-block" && !isCompleteHtmlBlock(source)) {
    return null;
  }
  // A table only converts once it has at least one real data row — otherwise
  // pressing Enter after typing the header + divider would freeze the block
  // before the body rows are written.
  if (type === "table" && !hasAtLeastOneBodyRow(source)) {
    return null;
  }

  // Wrap in a container so block DecoratorNodes (equation, html-block) can be
  // exported to Markdown for the round-trip comparison.
  const container = $createParagraphNode();
  container.append(node);
  const exported = $exportMarkdownString(container);
  if (exported === null) return null;
  if (normalizeForCompare(exported) !== exportCompareSource(type, source)) {
    return null;
  }
  return node;
}

/**
 * Replaces the paragraphs from `startParagraph` through `endParagraph` with
 * the parsed block, then appends a fresh paragraph and moves the caret there.
 */
function $applyBlockConversion(
  startParagraph: ReturnType<typeof $createParagraphNode>,
  endParagraph: ReturnType<typeof $createParagraphNode>,
  block: LexicalNode,
): void {
  const root = $getRoot();
  const before = startParagraph.getPreviousSibling();

  const toRemove: (typeof startParagraph)[] = [];
  let cursor: (typeof startParagraph) | null = startParagraph;
  while (cursor !== null) {
    const next = cursor.getNextSibling() as (typeof startParagraph) | null;
    toRemove.push(cursor);
    if (cursor === endParagraph) break;
    cursor = next;
  }
  toRemove.forEach((paragraph) => paragraph.remove());

  if (before === null) {
    root.splice(0, 0, [block]);
  } else {
    before.insertAfter(block);
  }

  const caret = $createParagraphNode();
  block.insertAfter(caret);
  caret.selectStart();
}

export function MarkdownTypedBlockPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event !== null && (event.shiftKey || editor.isComposing())) {
          return false;
        }
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }
        const anchorNode = selection.anchor.getNode();
        if (!$isTextNode(anchorNode)) return false;

        const endParagraph = anchorNode.getParent();
        if (endParagraph === null || !$isParagraphNode(endParagraph)) {
          return false;
        }
        // Only a caret at the very end of the paragraph can close a block.
        if (endParagraph.getLastChild() !== anchorNode) return false;
        if (selection.anchor.offset !== anchorNode.getTextContentSize()) {
          return false;
        }
        // Stay at document level so we don't grab lines inside a list/quote.
        if (!$isRootOrShadowRoot(endParagraph.getParent())) return false;

        let converted = false;
        editor.update(() => {
          const current = $getSelection();
          if (!$isRangeSelection(current)) return;
          const anchor = current.anchor.getNode();
          if (!$isTextNode(anchor)) return;
          const end = anchor.getParent();
          if (end === null || !$isParagraphNode(end)) return;

          let start = end;
          const lines = [end.getTextContent()];

          while (true) {
            const block = $parseSingleBlock(lines.join("\n"));
            if (block !== null) {
              $applyBlockConversion(start, end, block);
              converted = true;
              $addUpdateTag(HISTORY_PUSH_TAG);
              break;
            }
            const prev = start.getPreviousSibling();
            if (prev === null || !$isParagraphNode(prev)) break;
            const text = prev.getTextContent();
            if (!text) break; // empty paragraph ends a block
            if (lines.length >= MAX_GATHER_LINES) break;
            lines.unshift(text);
            start = prev;
          }
        });

        if (converted) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}