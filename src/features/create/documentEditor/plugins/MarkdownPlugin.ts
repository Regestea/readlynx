import { useEffect } from "react";
import type { ElementNode } from "lexical";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
} from "lexical";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  CODE,
  HEADING,
  isTableRowDivider,
  ORDERED_LIST,
  registerMarkdownShortcuts,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  UNORDERED_LIST,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextFormatTransformer,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createQuoteNode, $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createCalloutNode,
  $isCalloutNode,
  CalloutNode,
} from "../nodes/CalloutNode";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createCustomBlockNode,
  $isCustomBlockNode,
  CustomBlockNode,
} from "../nodes/CustomBlockNode";
import { $createImageNode, $isImageNode, ImageNode } from "../nodes/ImageNode";
import {
  $createEquationNode,
  $isEquationNode,
  EquationNode,
} from "../nodes/EquationNode";
import {
  $createHtmlBlockNode,
  $isHtmlBlockNode,
  HtmlBlockNode,
  sanitizeHtmlBlock,
} from "../nodes/HtmlBlockNode";
import type { CalloutTone, CustomBlockKind } from "../types";

/* ---------- GFM table ---------- */

const TABLE_LINE_RE = /^\|.*\|\s*$/;

function $parseTableLine(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

const TABLE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [TableNode, TableRowNode, TableCellNode],
  regExpStart: /^\|/,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    let i = startLineIndex;
    const rows: string[] = [];
    while (i < lines.length && TABLE_LINE_RE.test(lines[i])) {
      rows.push(lines[i]);
      i += 1;
    }
    if (rows.length < 2 || !isTableRowDivider(rows[1])) {
      return null;
    }
    const header = $parseTableLine(rows[0]);
    const body = rows.slice(2).map($parseTableLine);
    const colCount = header.length;
    if (colCount === 0) return null;

    const table = $createTableNodeWithDimensions(body.length + 1, colCount);
    const tableRows = table.getChildren();
    tableRows.forEach((rowNode, ri) => {
      if (!$isTableRowNode(rowNode)) return;
      const cells = rowNode.getChildren();
      const values = ri === 0 ? header : (body[ri - 1] ?? []);
      cells.forEach((cellNode, ci) => {
        if (!$isTableCellNode(cellNode)) return;
        if (ri === 0) cellNode.setHeaderStyles(TableCellHeaderStates.ROW);
        const value = values[ci];
        if (value === undefined) return;
        const existing = cellNode.getFirstChild();
        const paragraph = $isParagraphNode(existing) ? existing : $createParagraphNode();
        paragraph.clear();
        // Cells may contain inline markdown (bold, italic, links, …); parse
        // it so the formatting renders instead of showing literal `**…**`.
        if (value !== "") $convertFromMarkdownString(value, TEXT_ONLY_TRANSFORMERS, paragraph);
        if (paragraph !== existing) cellNode.append(paragraph);
      });
    });
    rootNode.append(table);
    return [true, i - 1];
  },
  replace() {
    return false;
  },
  export(node, traverseChildren) {
    if (!$isTableNode(node)) return null;
    const lines: string[] = [];
    let dividerPushed = false;
    node.getChildren().forEach((rowNode) => {
      if (!$isTableRowNode(rowNode)) return;
      const cells = rowNode.getChildren().filter($isTableCellNode);
      const isHeader =
        cells.length > 0 &&
        cells.every((cell) => cell.__headerState !== TableCellHeaderStates.NO_STATUS);
      lines.push(
        "| " +
          cells
            .map((cell) => traverseChildren(cell).replace(/\n/g, " ").trim())
            .join(" | ") +
          " |",
      );
      if (isHeader && !dividerPushed) {
        lines.push("| " + cells.map(() => "---").join(" | ") + " |");
        dividerPushed = true;
      }
    });
    return lines.join("\n");
  },
};

/* ---------- Image ---------- */

const IMAGE_MD_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:[ \t]+"([^"]*)")?[ \t]*\)/;

const IMAGE: ElementTransformer = {
  type: "element",
  dependencies: [ImageNode],
  regExp: IMAGE_MD_RE,
  replace(parentNode, children) {
    const textContent = children.map((child) => child.getTextContent()).join("");
    const match = textContent.match(IMAGE_MD_RE);
    if (!match) return false;
    const [, altText, src, title] = match;
    const rest = textContent.slice(match[0].length);
    parentNode.clear();
    parentNode.append($createImageNode({ src, altText, caption: title ?? "" }));
    if (rest) parentNode.append($createTextNode(rest));
  },
export(node) {
    if (!$isImageNode(node)) return null;
    const caption = node.getCaption()?.trim();
    const title = caption && caption.length > 0 ? ` "${caption.replace(/"/g, '\\"')}"` : "";
    return `![${node.getAltText()}](${node.getSrc()}${title})`;
  },
};

/* ---------- Thematic break ---------- */

const HR_RE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}\s*$/;

const HR: ElementTransformer = {
  type: "element",
  dependencies: [HorizontalRuleNode],
  regExp: HR_RE,
  replace(parentNode) {
    parentNode.replace($createHorizontalRuleNode());
  },
  export(node) {
    return $isHorizontalRuleNode(node) ? "---" : null;
  },
};

/* ---------- Callout ---------- */

const CALLOUT_RE = /^>\s*\[!([a-z]+)\]/i;
/** GitHub alert names -> the closest built-in callout tone. */
const ALERT_TONES: Record<string, CalloutTone> = {
  note: "info",
  info: "info",
  tip: "success",
  success: "success",
  important: "warning",
  warning: "warning",
  caution: "error",
  error: "error",
};

const CALLOUT: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [CalloutNode],
  regExpStart: /^>\s*\[!/,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const toneMatch = lines[startLineIndex].match(CALLOUT_RE);
    if (!toneMatch) return null;
    const tone = ALERT_TONES[toneMatch[1].toLowerCase()];
    if (!tone) return null;
    const label = toneMatch[1].toUpperCase();
    let i = startLineIndex;
    const content: string[] = [];
    const firstLine = lines[startLineIndex].replace(CALLOUT_RE, "").trim();
    if (firstLine) content.push(firstLine);
    i += 1;
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      content.push(lines[i].replace(/^>\s?/, ""));
      i += 1;
    }
    const callout = $createCalloutNode(tone, label);
    for (const line of content) {
      const paragraph = $createParagraphNode();
      $convertFromMarkdownString(line, TEXT_ONLY_TRANSFORMERS, paragraph);
      callout.append(paragraph);
    }
    if (callout.getChildrenSize() === 0) callout.append($createParagraphNode());
    rootNode.append(callout);
    return [true, i - 1];
  },
  replace() {
    return false;
  },
  export(node, traverseChildren) {
    if (!$isCalloutNode(node)) return null;
    const content = traverseChildren(node);
    const lines = content.split("\n");
    const first = `> [!${node.getLabel()}]${lines[0] ? ` ${lines[0]}` : ""}`;
    const rest = lines
      .slice(1)
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    return rest ? `${first}\n${rest}` : first;
  },
};

/* ---------- Custom block ---------- */

const CUSTOM_BLOCK_RE = /^:::\s*([a-z]+)\s*$/i;
const CUSTOM_BLOCK_KINDS: CustomBlockKind[] = ["aside", "spoiler", "insight"];

const CUSTOM_BLOCK: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [CustomBlockNode],
  regExpStart: /^:::/,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const kindMatch = lines[startLineIndex].match(CUSTOM_BLOCK_RE);
    if (!kindMatch || !CUSTOM_BLOCK_KINDS.includes(kindMatch[1].toLowerCase() as CustomBlockKind)) {
      return null;
    }
    const kind = kindMatch[1].toLowerCase() as CustomBlockKind;
    let i = startLineIndex + 1;
    const content: string[] = [];
    while (i < lines.length && !/^:::/.test(lines[i])) {
      content.push(lines[i]);
      i += 1;
    }
    const block = $createCustomBlockNode(kind);
    for (const line of content) {
      if (!line.trim()) continue;
      const paragraph = $createParagraphNode();
      $convertFromMarkdownString(line, TEXT_ONLY_TRANSFORMERS, paragraph);
      block.append(paragraph);
    }
    if (block.getChildrenSize() === 0) block.append($createParagraphNode());
    rootNode.append(block);
    return [true, i - 1];
  },
  replace() {
    return false;
  },
  export(node, traverseChildren) {
    if (!$isCustomBlockNode(node)) return null;
    const content = traverseChildren(node);
    return `:::${node.getKind()}\n${content}\n:::`;
  },
};

/* ---------- Block equation ($$ … $$) ---------- */

const BLOCK_EQUATION: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [EquationNode],
  regExpStart: /^\$\$/,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const line = lines[startLineIndex];
    const rest = line.slice(2);

    // Single-line form: $$…$$
    if (rest.endsWith("$$") && rest.length > 2) {
      const equation = rest.slice(0, -2).trim();
      if (!equation) return null;
      rootNode.append($createEquationNode(equation, false));
      return [true, startLineIndex];
    }

    // Only the exact "$$" opener starts a multi-line block.
    if (rest.trim() !== "") return null;

    const content: string[] = [];
    for (let i = startLineIndex + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\$\$/.test(l)) {
        if (content.length === 0) return null;
        rootNode.append($createEquationNode(content.join("\n"), false));
        return [true, i];
      }
      content.push(l);
    }
    return null;
  },
  replace() {
    return false;
  },
  export(node) {
    if (!$isEquationNode(node) || node.isInline()) return null;
    return `$$\n${node.getEquation()}\n$$`;
  },
};

/* ---------- Inline equation ($…$) ---------- */

const INLINE_EQUATION: TextMatchTransformer = {
  type: "text-match",
  dependencies: [EquationNode],
  importRegExp: /(?<!\$)\$([^$\n]+)\$(?!\$)/,
  regExp: /(?<!\$)\$([^$\n]+)\$(?!\$)/,
  trigger: "$",
  replace(textNode, match) {
    const equation = match[1];
    if (!equation || equation !== equation.trim()) return undefined;
    textNode.replace($createEquationNode(equation.trim(), true));
  },
  export(node) {
    if (!$isEquationNode(node) || !node.isInline()) return null;
    return `$${node.getEquation()}$`;
  },
};

/* ---------- Raw HTML block ---------- */

const HTML_BLOCK_TAG_RE =
  /^(!--|div|p|section|article|aside|header|footer|main|nav|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|dl|dt|dd|figure|figcaption|blockquote|pre|iframe|video|audio|canvas|details|summary|h[1-6]|hr|br|form|fieldset)\b/i;

export const HTML_BLOCK_START_RE = /^\s{0,3}<(?:[/!]?)(?:[a-zA-Z][\w-]*|--|!)/;

/** Collects the non-blank lines of an HTML block starting at `startLineIndex`
 *  and appends a sanitized HtmlBlockNode. Returns the consumed index range. */
function appendHtmlBlock(
  lines: string[],
  startLineIndex: number,
  rootNode: ElementNode,
): [true, number] | null {
  const htmlLines: string[] = [];
  let i = startLineIndex;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "") break;
    htmlLines.push(l);
    i += 1;
  }
  const html = sanitizeHtmlBlock(htmlLines.join("\n"));
  if (!html.trim()) return null;
  rootNode.append($createHtmlBlockNode(html));
  return [true, i - 1];
}

const HTML_BLOCK: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [HtmlBlockNode],
  regExpStart: HTML_BLOCK_START_RE,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const first = lines[startLineIndex].trimStart();
    // HTML comment blocks.
    if (/^<!--/.test(first)) {
      return appendHtmlBlock(lines, startLineIndex, rootNode);
    }
    const closing = first.startsWith("</");
    const tagMatch = (closing ? first.slice(2) : first.slice(1)).match(/^([a-zA-Z][\w:-]*)\b/);
    if (!tagMatch || !HTML_BLOCK_TAG_RE.test(tagMatch[1])) {
      return null;
    }
    return appendHtmlBlock(lines, startLineIndex, rootNode);
  },
  replace() {
    return false;
  },
  export(node) {
    return $isHtmlBlockNode(node) ? node.getHtml() : null;
  },
};

/* ---------- Nested blockquote ---------- */

const QUOTE_PREFIX_RE = /^[ \t]{0,3}(?:>[ \t]?)+/;

interface QuoteItem {
  depth: number;
  text: string;
}

/** Builds nested QuoteNodes from prefix-counted lines (outline-style). */
function $buildQuoteTree(items: QuoteItem[]): QuoteNode | null {
  const root = $createQuoteNode();
  const stack: { depth: number; quote: QuoteNode }[] = [{ depth: 0, quote: root }];
  let paragraph: { quote: QuoteNode; node: ReturnType<typeof $createParagraphNode> } | null =
    null;

  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }
    let top = stack[stack.length - 1];
    if (top.depth < item.depth) {
      const nested = $createQuoteNode();
      top.quote.append(nested);
      stack.push({ depth: item.depth, quote: nested });
      top = stack[stack.length - 1];
    }
    if (item.text.trim() === "") {
      paragraph = null;
      continue;
    }
    if (paragraph === null || paragraph.quote !== top.quote) {
      paragraph = { quote: top.quote, node: $createParagraphNode() };
      top.quote.append(paragraph.node);
    } else {
      paragraph.node.append($createLineBreakNode());
    }
    $convertFromMarkdownString(item.text, TEXT_ONLY_TRANSFORMERS, paragraph.node);
  }

  return root.getChildrenSize() === 0 ? null : root;
}

const QUOTE_NESTED: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [QuoteNode],
  regExpStart: /^[ \t]{0,3}>/,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const items: QuoteItem[] = [];
    let i = startLineIndex;
    while (i < lines.length) {
      const match = lines[i].match(QUOTE_PREFIX_RE);
      if (!match) break;
      const depth = (match[0].match(/>/g) ?? []).length;
      items.push({ depth, text: lines[i].slice(match[0].length) });
      i += 1;
    }
    if (items.length === 0) return null;
    const quote = $buildQuoteTree(items);
    if (quote === null) return null;
    rootNode.append(quote);
    return [true, i - 1];
  },
  replace() {
    return false;
  },
  export(node, traverseChildren) {
    if (!$isQuoteNode(node)) return null;
    const content = traverseChildren(node);
    if (content === "") return null;
    return content
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  },
};

/* ---------- Autolinks (<https://…>, <mail@…>) ---------- */

const WEB_AUTOLINK: TextMatchTransformer = {
  type: "text-match",
  dependencies: [LinkNode],
  importRegExp: /<(https?:\/\/[^\s<>]+)>/,
  regExp: /<(https?:\/\/[^\s<>]+)>/,
  trigger: "<",
  replace(textNode, match) {
    const url = match[1];
    if (!url) return;
    const linkNode = $createLinkNode(url);
    const textNode_ = $createTextNode(url);
    linkNode.append(textNode_);
    textNode.replace(linkNode);
    return textNode_;
  },
  export(node) {
    if (!$isLinkNode(node)) return null;
    const text = node.getTextContent();
    const url = node.getURL();
    if (!text || text !== url) return null;
    return `<${text}>`;
  },
};

const EMAIL_AUTOLINK: TextMatchTransformer = {
  type: "text-match",
  dependencies: [LinkNode],
  importRegExp: /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/,
  regExp: /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/,
  trigger: "<",
  replace(textNode, match) {
    const email = match[1];
    if (!email) return;
    const linkNode = $createLinkNode(`mailto:${email}`);
    const textNode_ = $createTextNode(email);
    linkNode.append(textNode_);
    textNode.replace(linkNode);
    return textNode_;
  },
  export(node) {
    if (!$isLinkNode(node)) return null;
    const text = node.getTextContent();
    if (!text || node.getURL() !== `mailto:${text}`) return null;
    return `<${text}>`;
  },
};

/* ---------- Subscript / superscript ---------- */

const SUBSCRIPT: TextFormatTransformer = {
  format: ["subscript"],
  tag: "~",
  type: "text-format",
};

const SUPERSCRIPT: TextFormatTransformer = {
  format: ["superscript"],
  tag: "^",
  type: "text-format",
};

/* ---------- Public helpers ---------- */

/** Inline-only transformers used for content nested inside callouts, custom
 *  blocks and blockquotes (block constructs don't apply there). */
const TEXT_ONLY_TRANSFORMERS: Transformer[] = [
  ...TEXT_FORMAT_TRANSFORMERS,
  SUBSCRIPT,
  SUPERSCRIPT,
  INLINE_EQUATION,
  WEB_AUTOLINK,
  EMAIL_AUTOLINK,
  ...TEXT_MATCH_TRANSFORMERS,
];

export const mdTransformers: Transformer[] = [
  BLOCK_EQUATION,
  HTML_BLOCK,
  TABLE,
  IMAGE,
  HR,
  CALLOUT,
  CUSTOM_BLOCK,
  HEADING,
  QUOTE_NESTED,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  CODE,
  ...TEXT_FORMAT_TRANSFORMERS,
  SUBSCRIPT,
  SUPERSCRIPT,
  WEB_AUTOLINK,
  EMAIL_AUTOLINK,
  ...TEXT_MATCH_TRANSFORMERS,
  INLINE_EQUATION,
];

export function importMarkdownString(target: ElementNode, markdown: string): void {
  $convertFromMarkdownString(markdown, mdTransformers, target);
}

export function $exportMarkdownString(root: ElementNode): string {
  return $convertToMarkdownString(mdTransformers, root);
}

/* ---------- Plugin ---------- */

interface MarkdownPluginProps {
  shortcuts?: boolean;
}

export function MarkdownPlugin({ shortcuts = true }: MarkdownPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!shortcuts) return;
    return registerMarkdownShortcuts(editor, mdTransformers);
  }, [editor, shortcuts]);

  return null;
}
