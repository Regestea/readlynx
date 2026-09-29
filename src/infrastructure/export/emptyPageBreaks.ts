import { CHAPTER_INDEX_ATTR, stampChapterBreaks } from "./chapterBreaks";

/**
 * Chapter breaks that would leave a page nearly empty.
 *
 * A break before a heading is right when the page it opens holds a real amount
 * of content. It is wrong when that page holds a line or two: the page opens,
 * holds almost nothing, and is abandoned by the next break. Books assembled
 * from per-page translations hit this constantly.
 *
 * Rather than guess from character counts, this measures the *actual* rendered
 * page: paginate once, look at how many lines of body text each opener page
 * really holds, drop the breaks that opened an under-filled one, and paginate
 * once more. Dropping a break only ever moves content earlier, so one measure
 * pass plus one confirm pass is enough — at most two paginations.
 */

/** A page is only judged against a fraction of its capacity, so an absolute
 *  `minLines` that exceeds what the page can physically hold (small page, large
 *  font, "20+ lines") degrades to "half a page" instead of deleting every
 *  break in the document. */
const MAX_PAGE_FRACTION = 0.5;

/** Non-leaf boxes whose own rectangle matters. Text leaves are always
 *  measured; these are the visual blocks (`break-inside: avoid` media, code,
 *  tables…) whose box can extend past their inner leaves, or whose leaves can
 *  be empty. Plain `DIV` wrappers are deliberately excluded: Paged.js wraps
 *  the flow in a `<div>` that is exactly page-height, and measuring it
 *  reported a completely full page for every page. */
const MEASURED_BLOCKS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "IMG",
  "FIGURE",
  "TABLE",
  "PRE",
  "ASIDE",
  "SECTION",
  "BLOCKQUOTE",
  "HR",
  "UL",
  "OL",
  "SVG",
  "CANVAS",
  "VIDEO",
]);

/** Line height of a page's text, in CSS px. */
function lineHeightPx(content: HTMLElement): number {
  const declared = Number.parseFloat(getComputedStyle(content).lineHeight);
  if (Number.isFinite(declared) && declared > 0) return declared;
  // `line-height: normal` parses to NaN, so fall back to the first leaf's size.
  const leaf = content.querySelector<HTMLElement>("*");
  const fontSize = leaf ? Number.parseFloat(getComputedStyle(leaf).fontSize) : Number.NaN;
  return (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 15) * 1.6;
}

/** Usable content-box height of one page, in CSS px, or `null` when it cannot
 *  be measured. */
function availableHeightPx(content: HTMLElement): number | null {
  const rect = content.getBoundingClientRect();
  const style = getComputedStyle(content);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const available = rect.height - paddingTop - paddingBottom;
  return available > 0 ? available : null;
}

/** Effective threshold for an opener page: the requested `minLines`, capped at
 *  half the page capacity so the option stays meaningful across page sizes and
 *  font scales. */
function effectiveThreshold(minLines: number, content: HTMLElement): number {
  const perLine = lineHeightPx(content);
  const available = availableHeightPx(content);
  if (!(perLine > 0) || available === null) return minLines;
  const capacityLines = available / perLine;
  if (!(capacityLines > 0)) return minLines;
  return Math.min(minLines, capacityLines * MAX_PAGE_FRACTION);
}

/** Filled height of one page, in lines of body text, or `null` when the page
 *  cannot be measured. */
function pageFillLines(page: HTMLElement): number | null {
  const content = page.querySelector<HTMLElement>(".pagedjs_page_content");
  if (!content) return null;
  const perLine = lineHeightPx(content);
  if (!(perLine > 0)) return null;

  const contentRect = content.getBoundingClientRect();
  const style = getComputedStyle(content);
  const top = contentRect.top + (Number.parseFloat(style.paddingTop) || 0);

  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of content.querySelectorAll<HTMLElement>("*")) {
    const isLeaf = element.children.length === 0;
    if (!isLeaf && !MEASURED_BLOCKS.has(element.tagName)) continue;
    const rect = element.getBoundingClientRect();
    if (!(rect.height > 0)) continue;
    // Skip the Paged.js flow wrapper: it is exactly page-height, so keeping
    // it would mark every page as completely full and quietly disable the
    // whole feature.
    if (rect.height >= contentRect.height * 0.95) continue;
    if (rect.bottom > bottom) bottom = rect.bottom;
  }
  if (!Number.isFinite(bottom)) return null;

  const used = bottom - top;
  return used > 0 ? used / perLine : 0;
}

/** The stamped heading that opened this page, or null when the page begins with
 *  ordinary content. Blaming a break that merely appears lower down the page
 *  would drop it for no reason, so the heading has to be the first thing on
 *  it. */
function pageOpenerIndex(content: HTMLElement): number | null {
  const opener = content.querySelector(`[${CHAPTER_INDEX_ATTR}]`);
  if (!opener) return null;
  const attr = opener.getAttribute(CHAPTER_INDEX_ATTR);
  if (attr === null) return null;
  // Paged.js wraps the flow in its own div, so the opener is rarely the first
  // child. Walk the text instead and check nothing visible precedes it.
  const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (opener.contains(node) || node === opener) break;
    if ((node.textContent ?? "").trim() !== "") return null;
  }
  const index = Number(attr);
  return Number.isInteger(index) && index >= 0 ? index : null;
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
    if (lines < effectiveThreshold(minLines, content)) offenders.add(index);
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
 * Paginates `bodyHtml`, dropping the chapter breaks that open a page emptier
 * than `minLines` lines.
 *
 * `paginate` is supplied by the caller so both the dialog preview and the
 * standalone export share this exact logic and therefore cannot disagree about
 * the result. `minLines` of 0 disables the whole thing and runs one pass.
 * At most two paginations run: one to measure, one to confirm after dropping.
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
  let result = await paginate(stampChapterBreaks(bodyHtml, ticked, new Set()));
  if (!(minLines > 0)) return { result, dropped: [] };

  const offenders = underFilledBreaks(pagesOf(result), minLines);
  if (offenders.size === 0) return { result, dropped: [] };

  const dropped = [...offenders].sort((a, b) => a - b);
  result = await paginate(stampChapterBreaks(bodyHtml, ticked, offenders));
  return { result, dropped };
}
