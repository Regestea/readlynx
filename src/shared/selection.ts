/** Collapsed end rect of the selection, or null when the selection has no
 *  rendered end (e.g. it was just cleared). */
export function getSelectionEndRect(sel: Selection): DOMRect | null {
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rect = range.getBoundingClientRect();
  if (!rect.top && !rect.left && rect.width === 0 && rect.height === 0) return null;
  return rect;
}