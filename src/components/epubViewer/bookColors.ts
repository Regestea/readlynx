import {
  channelDistance,
  chroma,
  compositeOver,
  contrastRatio,
  fixTextContrast,
  mixColors,
  opaqueColor,
  parseCssColor,
  repairSurface,
  softenWithPalette,
  toCssColor,
  MIN_VISIBLE_DELTA,
  type Rgb,
} from "./colorMath";
import { TEXT_COLORS } from "../../shared/document/textColors";

/**
 * Makes a rendered book chapter fit the reader's page without flattening the
 * publisher's design. Every book ships its own stylesheet, and those colours
 * were picked for the page the book had in mind: flip the reader to a dark
 * theme (or let the user pick a black page) and its white callout boxes,
 * light-grey footnotes and pale headings turn unreadable.
 *
* The pass therefore repairs instead of repainting — a book colour that reads
 * well is left exactly as it is, and only the parts that actually fail against
 * the current page are rewritten:
 *
 *  1. surfaces: a box that fights the page (light box on a dark page) or has
 *     gone invisible is rebuilt as a tinted panel that keeps the book's hue;
 *     publisher design that fits the page is untouched;
 *  2. links: badly converted books hide whole paragraphs inside an `<a>`
 *     (index terms, mostly), which drags the link colour — often a screaming
 *     red — across an entire page. An `<a>` that wraps blocks, or that has no
 *     `href` at all, is prose and is given the colour of the text around it;
 *  3. text: long prose is muted when it is too saturated to read at length,
 *     and every colour that misses the WCAG target against the surface it
 *     actually sits on is walked towards black/white along its own hue, so a
 *     red heading stays red — just dark enough to read. With the reader's
 *     "soft colors" option on, the palette of curated reading inks instead caps
 *     how loud each hue may be — for accents and headings too, not just prose;
 *  4. borders: rules that disappeared into the page are given a subtle tone;
 *  5. SVG labels: fills are judged against the page, like ordinary text.
 *
 * Repairs are written as inline `!important` declarations (which outrank the
 * book's own `!important` rules) and are always rolled back before a new pass,
 * so the computation always starts from the publisher's CSS and never from a
 * previous repair.
 */

export interface BookColorOptions {
  /** Opaque page background of the reader. */
  page: string;
  /** Reader text colour, used when a book colour cannot be repaired in place. */
  text: string;
  /** Minimum contrast for body text. */
  minContrast?: number;
  /** Minimum contrast for large text (≥24px, or ≥19px bold). */
  largeTextContrast?: number;
  /** Contrast a rebuilt surface keeps against the page: visible, not loud. */
  surfaceContrast?: number;
  /** Rewrite unreadable text colours (off while the hard override is on). */
  adaptText?: boolean;
  /** Rewrite surfaces that fight the page or went invisible. */
  adaptSurfaces?: boolean;
/** Rescue borders that vanished into the page. */
  adaptBorders?: boolean;
  /** Rescue SVG text fills. */
  adaptSvgText?: boolean;
  /** Replace author colours that are louder than the soft ink of their hue
   *  family — the "soft colors" reader option, which also covers the short
   *  accents prose softening never touches. On by default: the reading inks are
   *  the app-wide palette, and the reader opts back out to the publisher's own
   *  colours per book or in Settings → EPUB defaults. */
  softColors?: boolean;
  /** Upper bound on visited elements, so a huge chapter cannot stall a repaint. */
  maxElements?: number;
}

export interface BookColorReport {
  surfaces: number;
  texts: number;
  borders: number;
  /** `<a>` wrappers turned back into prose (mis-converted index terms). */
  links: number;
  /** Colours swapped for a soft ink because they were too loud. */
  softened: number;
  /** Text nodes left alone because their background is an image/gradient. */
  skipped: number;
}

const DEFAULTS = {
  minContrast: 4.5,
  largeTextContrast: 3,
  surfaceContrast: 1.35,
  adaptText: true,
  adaptSurfaces: true,
  adaptBorders: true,
  adaptSvgText: true,
  softColors: true,
  maxElements: 6000,
} satisfies Omit<Required<BookColorOptions>, "page" | "text">;

/** Tags the reader styles itself — never patched. */
const OWN_TAGS = new Set([
  "HTML",
  "HEAD",
  "BODY",
  "SCRIPT",
  "STYLE",
  "META",
  "LINK",
  "TITLE",
  "BASE",
  "NOSCRIPT",
]);

/** Surfaces the reader paints itself (code shells and image wrappers): the
 *  book never gets a say there, and a picked code colour must survive. */
const OWN_SURFACE_SELECTOR = "pre, code, .rlx-img-wrap";

/** Text the reader paints itself: the Highlight.js palette and the fullscreen
 *  glyph, both of which already follow the reader's colours. */
const OWN_TEXT_SELECTOR = "pre.source-code, .rlx-img-wrap";

/** Elements a link label never wraps. Finding one inside an `<a>` means the
 *  markup is a mis-converted index term (or a whole block the converter
 *  wrapped by accident) rather than a link. */
const BLOCK_SELECTOR =
  "p, div, section, article, ul, ol, li, dl, dt, dd, table, thead, tbody, tfoot, tr, td, th, blockquote, pre, figure, figcaption, h1, h2, h3, h4, h5, h6";

/** Direct text at least this long is prose, not an accent — a saturated colour
 *  on a whole paragraph is the classic unreadable EPUB, whether the publisher
 *  painted it or a link colour was dragged across it. */
const LONG_TEXT_CHARS = 60;

/** Above this HSL chroma, long prose is mixed towards the reader's own text
 *  colour. Deliberately generous: most of the curated reading inks sit below
 *  it, so a publisher palette that matches them is left alone. */
const MAX_LONG_TEXT_CHROMA = 0.42;
const LONG_TEXT_MUTE = 0.45;

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/** Soft inks the "soft colors" option maps loud colours onto: the app's curated
 *  reading inks, which are the tones chosen for long-form text. The nearest hue
 *  wins, and its chroma becomes the ceiling for that hue family. */
const SOFT_INKS: Rgb[] = TEXT_COLORS.map((entry) => opaqueColor(entry.value)).filter(
  (color): color is Rgb => color !== null,
);

type StyleElement = HTMLElement | SVGElement;

interface Patch {
  element: StyleElement;
  property: string;
  value: string;
  priority: string;
}

/** Per-document list of the inline declarations this module owns. */
const PATCHES = new WeakMap<Document, Patch[]>();

/** Options the document was last repaired with, so an unchanged page never
 *  pays for a second pass. */
const LAST_KEY = new WeakMap<Document, string>();
const LAST_REPORT = new WeakMap<Document, BookColorReport>();

const EMPTY_REPORT: BookColorReport = {
  surfaces: 0,
  texts: 0,
  borders: 0,
  links: 0,
  softened: 0,
  skipped: 0,
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function writePatch(element: Element, property: string, value: string, patches: Patch[]): void {
  const style = (element as StyleElement).style;
  if (!style) return;
  const current = style.getPropertyValue(property);
  if (normalize(current) === normalize(value)) return;
  patches.push({
    element: element as StyleElement,
    property,
    value: current,
    priority: style.getPropertyPriority(property),
  });
  // `!important` on purpose: the reader must win against a book that hardcodes
  // `color: #fff !important`, and inline important outranks stylesheet important.
  style.setProperty(property, value, "important");
}

/** Undoes every repair this module applied to a document. */
export function restoreBookColors(doc: Document): void {
  const patches = PATCHES.get(doc);
  LAST_KEY.delete(doc);
  LAST_REPORT.delete(doc);
  if (!patches?.length) return;
  for (const patch of patches) {
    const style = patch.element.style;
    if (!style) continue;
    if (patch.value) style.setProperty(patch.property, patch.value, patch.priority);
    else style.removeProperty(patch.property);
  }
  PATCHES.set(doc, []);
}

/** Stable key for a run, so the same options are never computed twice. */
function bookColorKey(options: BookColorOptions): string {
  return [
    options.page,
    options.text,
    options.minContrast ?? DEFAULTS.minContrast,
    options.largeTextContrast ?? DEFAULTS.largeTextContrast,
    options.surfaceContrast ?? DEFAULTS.surfaceContrast,
    options.adaptText ?? DEFAULTS.adaptText,
    options.adaptSurfaces ?? DEFAULTS.adaptSurfaces,
options.adaptBorders ?? DEFAULTS.adaptBorders,
    options.adaptSvgText ?? DEFAULTS.adaptSvgText,
    options.softColors ?? DEFAULTS.softColors,
  ].join("|");
}

function isOwnElement(element: Element, selector: string): boolean {
  if (OWN_TAGS.has(element.tagName)) return true;
  return typeof element.closest === "function" && element.closest(selector) !== null;
}

/** The text an element carries itself, trimmed — an empty result means it only
 *  holds child elements (a wrapper), so it has no colour of its own to judge. */
function directText(element: Element): string {
  let text = "";
  const nodes = element.childNodes;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.nodeType === 3) text += node.textContent ?? "";
  }
  return text.trim();
}

/**
 * An `<a>` that is not a link: one that wraps block content, or one with no
 * `href` at all (index-term anchors and internal targets). Both are prose the
 * publisher never meant to paint like a link.
 */
function isMisusedLink(anchor: Element): boolean {
  if (anchor.querySelector(BLOCK_SELECTOR)) return true;
  return !anchor.hasAttribute("href");
}

/**
 * The colour the surrounding prose uses, so a mis-structured `<a>` can be put
 * back to it. Looks at the nearest ancestor that is not another anchor.
 */
function proseColorFor(
  anchor: Element,
  readStyle: (element: Element) => CSSStyleDeclaration,
  background: Rgb,
): Rgb | null {
  let node: Element | null = anchor.parentElement;
  for (let step = 0; node && step < 6; step += 1) {
    if (node.tagName !== "A") {
      const parsed = parseCssColor(readStyle(node).color);
      if (parsed && parsed.a > 0.02) return compositeOver(parsed, background);
    }
    node = node.parentElement;
  }
  return null;
}

/** SVG labels (inline figures in technical books) carry their colour in
 *  `fill`, which `color` never touches. SVG tag names keep their source case,
 *  unlike HTML ones, so the comparison is case-insensitive. */
function isSvgText(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "text" || tag === "tspan";
}

function hasBackgroundImage(style: CSSStyleDeclaration): boolean {
  const image = style.backgroundImage;
  return Boolean(image) && image !== "none";
}

function isLargeText(style: CSSStyleDeclaration): boolean {
  const size = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(size)) return false;
  if (size >= 24) return true;
  const weight = Number.parseInt(style.fontWeight, 10);
  return size >= 18.66 && Number.isFinite(weight) && weight >= 700;
}

/**
 * One traversal's worth of reading: computed styles and resolved backgrounds
 * are cached per element, so a chapter is measured once per pass instead of
 * once per declaration. `reset()` drops the caches after the pass that wrote
 * inline styles.
 */
function createPassReader(view: Window, page: Rgb) {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const backgrounds = new Map<Element, Rgb | null>();

  const readStyle = (element: Element): CSSStyleDeclaration => {
    let style = styles.get(element);
    if (!style) {
      style = view.getComputedStyle(element);
      styles.set(element, style);
    }
    return style;
  };

  /**
   * What an element is really painted on: every ancestor background is
   * composited (the book's translucent panels included). Returns null when the
   * chain contains a picture or gradient — there is no honest answer there, so
   * the element is left to the book instead of being guessed at.
   */
  const resolveBackground = (element: Element | null): Rgb | null => {
    if (!element) return page;
    const cached = backgrounds.get(element);
    if (cached !== undefined) return cached;
    const style = readStyle(element);
    let result: Rgb | null;
    if (hasBackgroundImage(style)) {
      result = null;
    } else {
      const own = parseCssColor(style.backgroundColor);
      const parent = resolveBackground(element.parentElement);
      result = own && own.a > 0.02 && parent ? compositeOver(own, parent) : parent;
    }
    backgrounds.set(element, result);
    return result;
  };

  return { readStyle, resolveBackground, reset: () => void (styles.clear(), backgrounds.clear()) };
}

/**
 * Repairs one document in place. Safe to call on every content load and again
 * whenever the theme or a picked colour changes.
 */
export function harmonizeBookColors(
  doc: Document,
  options: BookColorOptions,
): BookColorReport {
  const key = bookColorKey(options);
  const cached = LAST_KEY.get(doc);
  if (cached === key) return LAST_REPORT.get(doc) ?? EMPTY_REPORT;
  restoreBookColors(doc);
  const settings = { ...DEFAULTS, ...options };
const report: BookColorReport = {
    surfaces: 0,
    texts: 0,
    borders: 0,
    links: 0,
    softened: 0,
    skipped: 0,
  };
  const body = doc.body;
  const view = doc.defaultView;
  const page = opaqueColor(settings.page);
  if (!body || !view || !page) return report;
  const textParsed = parseCssColor(settings.text);
  const text: Rgb = textParsed ? compositeOver(textParsed, page) : page;
  const patches: Patch[] = PATCHES.get(doc) ?? [];
  PATCHES.set(doc, patches);

  const elements = Array.from(body.querySelectorAll("*")).slice(0, settings.maxElements);
  const pass = createPassReader(view, page);

  // 1. Surfaces. The repairs are written once the pass is over: judging a panel
  //    against a panel we just rebuilt would mix the book's CSS with our own.
  if (settings.adaptSurfaces) {
    const pending: Array<[Element, string]> = [];
    for (const element of elements) {
      if (isOwnElement(element, OWN_SURFACE_SELECTOR)) continue;
      const style = pass.readStyle(element);
      if (hasBackgroundImage(style)) continue;
      const own = parseCssColor(style.backgroundColor);
      if (!own || own.a <= 0.02) continue;
      const behind = pass.resolveBackground(element.parentElement);
      if (!behind) continue;
      const repair = repairSurface(own, behind, settings.surfaceContrast);
      if (!repair.changed) continue;
      pending.push([element, toCssColor({ ...repair.color, a: 1 })]);
      report.surfaces += 1;
    }
    for (const [element, value] of pending) {
      writePatch(element, "background-color", value, patches);
    }
    pass.reset();
  }

  // 2. Links and text — measured against the surface each element really sits
  //    on, now including the panels repaired above.
  if (settings.adaptText || settings.adaptSvgText) {
    for (const element of elements) {
      if (isOwnElement(element, OWN_TEXT_SELECTOR)) continue;
      const isSvgLabel = isSvgText(element);
      const direct = isSvgLabel ? "" : directText(element);
      // An `<a>` has to be judged even without direct text: that is precisely
      // the shape of a mis-converted index term.
      const isAnchor = !isSvgLabel && element.tagName === "A";
      if (!isSvgLabel && !direct && !isAnchor) continue;
      const style = pass.readStyle(element);
      const background = pass.resolveBackground(element);
      if (!background) {
        report.skipped += 1;
        continue;
      }
      if (isSvgLabel && !settings.adaptSvgText) continue;
      let raw = parseCssColor(isSvgLabel ? style.fill : style.color);
      if (!raw || raw.a <= 0.02) continue;

      // An `<a>` that wraps paragraphs (or has no `href`) is prose, not a
      // link: give it back the colour of the text around it, which is what
      // the publisher would have used had the markup been well formed.
      if (isAnchor && isMisusedLink(element)) {
        const prose = proseColorFor(element, pass.readStyle, background);
        if (prose && channelDistance(compositeOver(raw, background), prose) >= 2) {
          writePatch(element, "color", toCssColor({ ...prose, a: 1 }), patches);
          raw = { ...prose, a: 1 };
          report.links += 1;
        }
      }

      const target = isLargeText(style) ? settings.largeTextContrast : settings.minContrast;
      let base = compositeOver(raw, background);
      let repaired = false;
      // "Soft colors": anything louder than the soft ink of its own hue family
      // is swapped for that ink's chroma — the curated reading palette decides
      // how loud a hue may be, the book still chooses the hue. Additive: the
      // prose rule below keeps working on top of it.
      if (settings.softColors) {
        const soft = softenWithPalette(raw, background, target, SOFT_INKS);
        const softened = compositeOver(soft, background);
        if (chroma(softened) < chroma(base) - 0.001) {
          base = softened;
          repaired = true;
          report.softened += 1;
        }
      }
      // A saturated colour on a whole paragraph of naked page text is
      // exhausting even when it technically reads; long prose is pulled
      // towards the reader's own text colour. Headings, captions, inline code
      // and real links — short accents — keep theirs, and so does text inside a
      // callout box, whose colour is part of that box's design.
      if (
        !HEADING_TAGS.has(element.tagName) &&
        direct.length >= LONG_TEXT_CHARS &&
        channelDistance(background, page) < 3 &&
        chroma(base) > MAX_LONG_TEXT_CHROMA
      ) {
        base = mixColors(base, text, LONG_TEXT_MUTE);
        repaired = true;
      }
      if (contrastRatio(base, background) < target) {
        base = fixTextContrast({ ...base, a: raw.a }, background, target, text);
        repaired = true;
      }
      if (!repaired) continue;
      writePatch(element, isSvgLabel ? "fill" : "color", toCssColor({ ...base, a: raw.a }), patches);
      report.texts += 1;
    }
  }

  // 3. Borders — a rule that disappeared into its own panel is structure the
  //    reader can no longer see; give it a tone instead of the book's colour.
  //    Repaired colours do not move any background, so the caches still hold.
  if (settings.adaptBorders) {
    const sides = ["top", "right", "bottom", "left"] as const;
    for (const element of elements) {
      if (isOwnElement(element, OWN_TEXT_SELECTOR)) continue;
      const style = pass.readStyle(element);
      if (
        sides.every(
          (side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0,
        )
      ) {
        continue;
      }
      const background = pass.resolveBackground(element);
      if (!background) continue;
      for (const side of sides) {
        const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
        const lineStyle = style.getPropertyValue(`border-${side}-style`);
        if (!Number.isFinite(width) || width <= 0 || lineStyle === "none") continue;
        const raw = parseCssColor(style.getPropertyValue(`border-${side}-color`));
        if (!raw) continue;
        if (channelDistance(compositeOver(raw, background), background) >= MIN_VISIBLE_DELTA) {
          continue;
        }
        const visible = mixColors(background, text, 0.32);
        writePatch(element, `border-${side}-color`, toCssColor({ ...visible, a: 1 }), patches);
        report.borders += 1;
      }
    }
  }

  LAST_KEY.set(doc, key);
  LAST_REPORT.set(doc, report);
  return report;
}
