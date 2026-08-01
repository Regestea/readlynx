import { useEffect } from "react";
import type { ElementNode } from "lexical";
import { $createParagraphNode, $createTextNode } from "lexical";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  isTableRowDivider,
  registerMarkdownShortcuts,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  TRANSFORMERS,
  type ElementTransformer,
  type MultilineElementTransformer,
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
  $createCustomBlockNode,
  $isCustomBlockNode,
  CustomBlockNode,
} from "../nodes/CustomBlockNode";
import { $createImageNode, $isImageNode, ImageNode } from "../nodes/ImageNode";
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

    const table = $createTableNodeWithDimensions(body.length, colCount);
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
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(value));
        cellNode.append(paragraph);
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

/* ---------- Public helpers ---------- */

export const mdTransformers: Transformer[] = [TABLE, IMAGE, CALLOUT, CUSTOM_BLOCK, ...TRANSFORMERS];

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
