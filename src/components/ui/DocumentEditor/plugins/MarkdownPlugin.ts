import { useEffect } from "react";
import type { ElementNode } from "lexical";
import { $createParagraphNode, $createTextNode, $isParagraphNode } from "lexical";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  CODE,
  HEADING,
  isTableRowDivider,
  ORDERED_LIST,
  QUOTE,
  registerMarkdownShortcuts,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  UNORDERED_LIST,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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

const TEXT_ONLY_TRANSFORMERS: Transformer[] = [
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
];

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
        paragraph.append($createTextNode(value));
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

const IMAGE_MD_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)/;

const IMAGE: ElementTransformer = {
  type: "element",
  dependencies: [ImageNode],
  regExp: IMAGE_MD_RE,
  replace(parentNode, children) {
    const textContent = children.map((child) => child.getTextContent()).join("");
    const match = textContent.match(IMAGE_MD_RE);
    if (!match) return false;
    const [, altText, src] = match;
    const rest = textContent.slice(match[0].length);
    parentNode.clear();
    parentNode.append($createImageNode({ src, altText }));
    if (rest) parentNode.append($createTextNode(rest));
  },
  export(node) {
    if (!$isImageNode(node)) return null;
    return `![${node.getAltText()}](${node.getSrc()})`;
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
const CALLOUT_TONES: CalloutTone[] = ["info", "success", "warning", "error"];

const CALLOUT: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [CalloutNode],
  regExpStart: /^>\s*\[!/,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const toneMatch = lines[startLineIndex].match(CALLOUT_RE);
    if (!toneMatch || !CALLOUT_TONES.includes(toneMatch[1].toLowerCase() as CalloutTone)) {
      return null;
    }
    const tone = toneMatch[1].toLowerCase() as CalloutTone;
    let i = startLineIndex;
    const content: string[] = [];
    const firstLine = lines[startLineIndex].replace(CALLOUT_RE, "").trim();
    if (firstLine) content.push(firstLine);
    i += 1;
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      content.push(lines[i].replace(/^>\s?/, ""));
      i += 1;
    }
    const callout = $createCalloutNode(tone);
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
    const first = `> [!${node.getTone()}]${lines[0] ? ` ${lines[0]}` : ""}`;
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
  /^(!--|div|p|section|article|aside|header|footer|main|nav|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|dl|dt|dd|figure|figcaption|blockquote|pre|iframe|video|audio|canvas|details|summary|h[1-6]|hr|form|fieldset)\b/i;

export const HTML_BLOCK_START_RE = /^\s{0,3}<(?:[/!]?)(?:[a-zA-Z][\w-]*|--|!)/;

const HTML_BLOCK: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [HtmlBlockNode],
  regExpStart: HTML_BLOCK_START_RE,
  handleImportAfterStartMatch({ lines, startLineIndex, rootNode }) {
    const first = lines[startLineIndex].trimStart();
    if (first.startsWith("</") || !HTML_BLOCK_TAG_RE.test(first.slice(1))) {
      return null;
    }
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
  },
  replace() {
    return false;
  },
  export(node) {
    return $isHtmlBlockNode(node) ? node.getHtml() : null;
  },
};

/* ---------- Public helpers ---------- */

export const mdTransformers: Transformer[] = [
  BLOCK_EQUATION,
  HTML_BLOCK,
  TABLE,
  IMAGE,
  HR,
  CALLOUT,
  CUSTOM_BLOCK,
  HEADING,
  QUOTE,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  CODE,
  ...TEXT_FORMAT_TRANSFORMERS,
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
