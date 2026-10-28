/** Collapsed start/end rects of the selection, or null when it has no
 *  rendered end (e.g. it was just cleared). Collapsing the clone to the
 *  relevant edge gives the caret rect at the first character of the first
 *  selected line (start) or after the last character of the last line (end). */
function caretRect(sel: Selection, atStart: boolean): DOMRect | null {
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(atStart);
  const rect = range.getBoundingClientRect();
  if (!rect.top && !rect.left && rect.width === 0 && rect.height === 0) return null;
  return rect;
}

export function getSelectionStartRect(sel: Selection): DOMRect | null {
  return caretRect(sel, true);
}

export function getSelectionEndRect(sel: Selection): DOMRect | null {
  return caretRect(sel, false);
}