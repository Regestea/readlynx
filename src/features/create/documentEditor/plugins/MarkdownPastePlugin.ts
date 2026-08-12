import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  PASTE_TAG,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
} from "lexical";
import type { PasteCommandType } from "lexical";
import { $generateNodesFromMarkdownString } from "@lexical/markdown";
import { $isCodeHighlightNode, $isCodeNode } from "@lexical/code";
import { $findMatchingParent } from "@lexical/utils";
import { mdTransformers } from "./MarkdownPlugin";
import { isRtlDominant } from "../utils/direction";

/**
 * Signals that clearly mark text as Markdown, checked at the start of lines.
 */
const BLOCK_SIGNALS: RegExp[] = [
  /^\s{0,3}#{1,6}\s/, // ATX heading
  /^\s{0,3}>\s?/, // blockquote
  /^\s{0,3}[-*+]\s+/, // bullet list
  /^\s{0,3}\d+[.)]\s+/, // ordered list
  /^\s{0,3}```/, // fenced code block
  /^\s{0,3}\$\$\s/, // display equation ($$ …$$)
  /^\$\$[\s\S]*\$\$/, // display equation on one line
  /^\s{0,3}\$$\s*$/, // multi-line display equation opener ($$)
  /^\s{0,3}\|.*\|/, // table row
  /^\s{0,3}:::\s*[a-z]+/, // custom block
  /^\s{0,3}!\[[^\]]*\]\([^)\s]+\)/, // image
  /^\s{0,3}([-*_]){3,}\s*$/, // thematic break
  /^\s{0,3}<(?:[/!]?)(?:[a-zA-Z][\w-]*|--|!)/, // raw HTML block
];

const INLINE_SIGNALS: RegExp[] = [
  /\[[^\]]*\]\([^)\s]+\)/, // link
  /!\[[^\]]*\]\([^)\s]+\)/, // image
  /\*\*[^*]+\*\*/, // bold
  /__[^_]+__/, // bold
  /`[^`\n]+`/, // inline code
  /~~[^~]+~~/, // strikethrough
  /\$[^$\n]+\$/, // inline math
];

function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;

  let blockHits = 0;
  let inlineHits = 0;
  for (const line of lines) {
    if (BLOCK_SIGNALS.some((re) => re.test(line))) {
      blockHits += 1;
    } else if (INLINE_SIGNALS.some((re) => re.test(line))) {
      inlineHits += 1;
    }
  }

  // A single block-level signal (heading, quote, list…) is enough.
  if (blockHits >= 1) return true;
  // A single inline signal (bold, link, inline code…) is enough too — even on
  // one line, so `**bold**` or `[link](url)` converts instead of pasting raw.
  return inlineHits >= 1;
}

/** Fallback text source when the clipboard only carries HTML (e.g. Word). */
function plainTextFromHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent ?? "";
}

/**
 * Auto-detects pasted Markdown and converts it into the editor's rich nodes
 * at the caret, instead of inserting it as plain text.
 */
export function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  const handledRef = useRef(false);

  useEffect(() => {
    return editor.registerCommand<PasteCommandType>(
      PASTE_COMMAND,
      (event) => {
        // A single Ctrl+V in Chromium/Electron dispatches PASTE_COMMAND twice:
        // once from `beforeinput` (insertFromPaste, an InputEvent with a
        // `dataTransfer`) and once from the DOM `paste` event (a ClipboardEvent
        // with `clipboardData`). Handle either source, but only insert once.
        let text =
          "clipboardData" in event && event.clipboardData
            ? event.clipboardData.getData("text/plain")
            : "dataTransfer" in event && event.dataTransfer
              ? event.dataTransfer.getData("text/plain")
              : "";
        if (!text.trim()) {
          const html =
            "clipboardData" in event && event.clipboardData
              ? event.clipboardData.getData("text/html")
              : "dataTransfer" in event && event.dataTransfer
                ? event.dataTransfer.getData("text/html")
                : "";
          text = html ? plainTextFromHtml(html) : "";
        }
        if (!text.trim() || !looksLikeMarkdown(text)) return false;

        // Never rewrite the raw syntax inside code blocks.
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const anchorNode = selection.anchor.getNode();
        const inCodeBlock =
          $isCodeNode(anchorNode) ||
          $isCodeHighlightNode(anchorNode) ||
          ($findMatchingParent(anchorNode, (node) => $isCodeNode(node) || $isCodeHighlightNode(node)) !== null);
        if (inCodeBlock) return false;

        if (!handledRef.current) {
          handledRef.current = true;
          editor.update(
            () => {
              const currentSelection = $getSelection();
              if (!$isRangeSelection(currentSelection)) return;
              const nodes = $generateNodesFromMarkdownString(text, mdTransformers);
              if (nodes.length === 0) return;
              // Set explicit direction on each pasted block so Persian/Arabic
              // blocks render RTL immediately. AutoDirectionPlugin only follows
              // the caret, so the blocks pasted *before* it would otherwise stay
              // `dir=null` (LTR base direction) until clicked.
              for (const node of nodes) {
                if ($isElementNode(node)) {
                  node.setDirection(isRtlDominant(node.getTextContent()) ? "rtl" : "ltr");
                }
              }
              currentSelection.insertNodes(nodes);
            },
            { tag: PASTE_TAG },
          );
        }

        event.preventDefault();
        // The `beforeinput` and `paste` events fire synchronously in the same
        // task, so clearing here never splits one paste into two inserts.
        setTimeout(() => {
          handledRef.current = false;
        }, 0);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
