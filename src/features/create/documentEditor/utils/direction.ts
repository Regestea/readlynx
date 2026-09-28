import { $isElementNode, type LexicalNode } from "lexical";
import { isRtlDominant } from "../../../../shared/document/direction";

export { classifyWord, isArabicDigit, isRtlCodePoint, isRtlDominant } from "../../../../shared/document/direction";

/**
 * Set explicit `dir` on each top-level block based on its dominant language.
 * Used when mapping markdown (e.g. an AI response) to editor nodes, so newly
 * created blocks carry their direction immediately - mirroring what
 * {@link AutoDirectionPlugin} does per caret block. Without this the blocks
 * stay `dir=null` and both the editor and any export render them LTR.
 */
export function $setBlockDirections(nodes: LexicalNode[]): void {
  for (const node of nodes) {
    if ($isElementNode(node)) {
      node.setDirection(isRtlDominant(node.getTextContent()) ? "rtl" : "ltr");
    }
  }
}
