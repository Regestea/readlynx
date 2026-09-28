/**
 * Chapter-break marking for exported documents.
 *
 * A heading that starts a new page carries the `rl-chapter-start` class, which
 * `PrintStyles.css` turns into `break-before: page`. The levels are chosen by
 * the user in the export dialog, so the rule stays level-agnostic and any
 * source can use it.
 *
 * The first heading of each level never gets the class: the document already
 * opens on a fresh page, and marking it would emit a leading blank page.
 */

/** Carries the heading's position in the document so a later pagination pass
 *  can name the break it wants removed. Stable across passes, because the
 *  heading sequence does not change. */
export const CHAPTER_INDEX_ATTR = "data-rl-chapter";

/** Containers a heading inside is *content*, not structure. A chapter break
 *  there would slice a quote or a table in half. */
const OPAQUE_CONTAINERS = new Set(["BLOCKQUOTE", "TD", "TH", "LI"]);

const HEADING_RE = /^H([1-6])$/;

/**
 * The document's structural headings, in order.
 *
 * Walks *into* plain containers rather than stopping at them. That matters:
 * `renderTranslatedBook` wraps the whole book in a single `<div dir="rtl">`,
 * so a direct-children scan found no headings at all and silently applied zero
 * breaks — the dialog's counters read 0 for every level and no page break was
 * ever inserted, even in a document full of them.
 */
export function structuralHeadings(root: ParentNode): Element[] {
  const found: Element[] = [];
  const walk = (parent: ParentNode): void => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName;
      if (HEADING_RE.test(tag)) {
        found.push(child);
        continue;
      }
      if (OPAQUE_CONTAINERS.has(tag)) continue;
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** How many structural headings the fragment has at each level, 1-based. */
export function countChapterHeadings(html: string): Record<number, number> {
  const counts: Record<number, number> = {};
  if (!html) return counts;
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    for (const heading of structuralHeadings(doc.body)) {
      const level = Number(HEADING_RE.exec(heading.tagName)?.[1] ?? 0);
      if (level > 0) counts[level] = (counts[level] ?? 0) + 1;
    }
  } catch {
    // A fragment that will not parse simply reports no headings.
  }
  return counts;
}

/** How many chapter breaks `levels` would produce before any are dropped. */
export function countChapterBreaks(html: string, levels: readonly number[]): number {
  const tags = wantedTags(levels);
  if (tags.size === 0) return 0;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const seen = new Set<string>();
  let breaks = 0;
  for (const heading of structuralHeadings(doc.body)) {
    const tag = heading.tagName;
    if (!tags.has(tag)) continue;
    if (seen.has(tag)) breaks += 1;
    seen.add(tag);
  }
  return breaks;
}

function wantedTags(levels: readonly number[]): Set<string> {
  return new Set(
    levels
      .map((level) => Math.min(5, Math.max(0, Math.trunc(level))))
      .filter((level) => level > 0)
      .map((level) => `H${level}`),
  );
}

/**
 * Stamps every heading of a ticked level, in place, except the first of each
 * level and any whose index is in `skip` (a break a previous pass judged not
 * worth a page).
 *
 * Every stamped heading also gets `CHAPTER_INDEX_ATTR`, which is how the
 * measurement pass maps an under-filled page back to the break that caused it.
 */
export function stampChapterBreaksIn(
  root: ParentNode,
  levels: readonly number[],
  skip: ReadonlySet<number> = new Set(),
): void {
  const tags = wantedTags(levels);
  if (tags.size === 0) return;
  const seen = new Set<string>();
  structuralHeadings(root).forEach((heading, index) => {
    const tag = heading.tagName;
    if (!tags.has(tag)) return;
    if (seen.has(tag) && !skip.has(index)) {
      heading.classList.add("rl-chapter-start");
      heading.setAttribute(CHAPTER_INDEX_ATTR, String(index));
    }
    seen.add(tag);
  });
}

/** Stamped markup, ready to paginate. An empty selection returns `html`
 *  untouched without parsing, so callers can pass the choice straight through. */
export function stampChapterBreaks(
  html: string,
  levels: readonly number[],
  skip: ReadonlySet<number> = new Set(),
): string {
  const wanted = levels.filter((level) => Math.trunc(level) > 0);
  if (wanted.length === 0 || !html) return html;
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    stampChapterBreaksIn(doc.body, wanted, skip);
    return doc.body.innerHTML;
  } catch {
    // A malformed fragment simply gets no breaks rather than failing the export.
    return html;
  }
}
