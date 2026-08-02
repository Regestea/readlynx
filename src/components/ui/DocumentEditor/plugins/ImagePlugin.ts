import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { $createParagraphNode } from "lexical";
import { $createImageNode } from "../nodes/ImageNode";

export function insertImage(editor: LexicalEditor, src: string, altText = "", width: number | null = null): void {
  editor.update(() => {
    const image = $createImageNode({ src, altText, width });
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertNodes([image]);
    } else {
      const paragraph = $createParagraphNode();
      paragraph.append(image);
      $getRoot().append(paragraph);
    }
  });
}
