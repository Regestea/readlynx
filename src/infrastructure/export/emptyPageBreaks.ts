import { CHAPTER_INDEX_ATTR, stampChapterBreaks } from "./chapterBreaks";

/**
 * Chapter breaks that would leave a page nearly empty.
 *
 * A break before a heading is right when the heading opens a real page of
 * content. It is wrong when the section under it is a line or two: the page
 * opens, holds almost nothing, and is abandoned by the next break. Books
 * assembled from per-page translations hit this constantly.
 *
 * Rather than guess from character counts, this measures the *actual* rendered
 * page: paginate, look at how many lines of text each page really holds, drop
 * the break that opened an under-filled one, and paginate again. The loop only
 * ever removes breaks, so it converges, and the pass cap bounds it.
 */

/** Passes of paginate-measure-drop. Three is enough in practice: one to find
 *  the offenders, one or two for the shifts they cause. */
const MAX_PASSES = 3;

/** Line height of a page's text, in CSS px. */
function lineHeightPx(content: HTMLElement): number {
  const declared = Number.parseFloat(getComputedStyle(content).lineHeight);
  if (Number.isFinite(declared) && declared > 0) return declared;
  // `line-height: normal` parses to NaN, so fall back to the first leaf's size.
  const leaf = content.querySelector<HTMLElement>("*");
  const fontSize = leaf ? Number.parseFloat(getComputedStyle(leaf).fontSize) : Number.NaN;
  return (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 15) * 1.6;
}

/** Filled height of one page, in lines of body text, or `null` when the page
 *  cannot be measured.
 *
 *  Only leaf elements count. Paged.js wraps the flow in a `<div>` that is
 *  exactly page-height, so measuring the last child reported a completely full
 *  page for every page — which would have marked every page as well filled and
 *  quietly disabled the whole feature. */
function pageFillLines(page: HTMLElement): number | null {
  const content = page.querySelector<HTMLElement>(".pagedjs_page_content");
  if (!content) return null;
  const perLine = lineHeightPx(content);
  if (!(perLine > 0)) return null;

  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of content.querySelectorAll<HTMLElement>("*")) {
    if (element.children.length > 0) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > bottom) bottom = rect.bottom;
  }
  if (!Number.isFinite(bottom)) return null;

  const top =
    content.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(content).paddingTop) || 0);
  const used = bottom - top;
  return used > 0 ? used / perLine : 0;
}

/** The stamped heading that opened this page, or null when the page begins with
 *  ordinary content. Blaming a break that merely appears lower down the page
 *  would drop it for no reason, so the heading has to be the first thing on it. */
function pageOpenerIndex(content: HTMLElement): number | null {
  const opener = content.querySelector(`[${CHAPTER_INDEX_ATTR}]`);
  const index = opener?.getAttribute(CHAPTER_INDEX_ATTR);
  if (!opener || index === null) return null;
  // Paged.js wraps the flow in its own div, so the opener is rarely the first
  // child. Walk the text instead and check nothing visible precedes it.
  const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (opener.contains(node) || node === opener) break;
    if ((node.textContent ?? "").trim() !== "") return null;
  }
  return Number(index);
}

/** Indices of the breaks that opened an under-filled page. */
function underFilledBreaks(pages: HTMLElement[], minLines: number): Set<number> {
  const offenders = new Set<number>();
  let measured = 0;
  for (const page of pages) {
    const content = page.querySelector<HTMLElement>(".pagedjs_page_content");
    if (!content) continue;
    const index = pageOpenerIndex(content);
    if (index === null) continue;
    const lines = pageFillLines(page);
    if (lines === null) continue;
    measured += 1;
    if (lines < minLines) offenders.add(index);
  }
  // If nothing could be measured, do not conclude every page is empty: that
  // would silently delete every break in the document.
  if (measured === 0 && pages.length > 0) return new Set();
  return offenders;
}

export interface ChapterPassResult<T> {
  /** The pagination to keep: the one produced by the final pass. */
  result: T;
  /** Indices of the breaks that were removed, for reporting in the dialog. */
  dropped: number[];
}

/**
 * Paginates `bodyHtml`, dropping the chapter breaks that leave a page emptier
 * than `minLines` lines.
 *
 * `paginate` is supplied by the caller so both the dialog preview and the
 * standalone export share this exact loop and therefore cannot disagree about
 * the result. `minLines` of 0 disables the whole thing and runs one pass.
 */
export async function paginateAvoidingEmptyPages<T>(
  bodyHtml: string,
  levels: readonly number[],
  minLines: number,
  paginate: (stampedHtml: string) => Promise<T>,
  pagesOf: (result: T) => HTMLElement[],
): Promise<ChapterPassResult<T>> {
  const ticked = levels.filter((level) => Math.trunc(level) > 0);
  if (ticked.length === 0) {
    return { result: await paginate(bodyHtml), dropped: [] };
  }

  // minLines of 0 means "keep every break": still stamp them, just do not drop
  // any. Skipping the stamp here would have silently disabled breaking instead.
  const skip = new Set<number>();
  let result = await paginate(stampChapterBreaks(bodyHtml, ticked, skip));
  const dropped: number[] = [];
  if (!(minLines > 0)) return { result, dropped };

  for (let pass = 1; pass < MAX_PASSES; pass += 1) {
    const offenders = underFilledBreaks(pagesOf(result), minLines);
    if (offenders.size === 0) break;
    // Never drop a break we already dropped, or the loop cannot make progress.
    let added = false;
    for (const index of offenders) {
      if (!skip.has(index)) {
        skip.add(index);
        added = true;
      }
    }
    if (!added) break;
    dropped.length = 0;
    dropped.push(...[...skip].sort((a, b) => a - b));
    result = await paginate(stampChapterBreaks(bodyHtml, ticked, skip));
  }

  return { result, dropped };
}
