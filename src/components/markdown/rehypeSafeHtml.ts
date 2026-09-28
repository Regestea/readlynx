import rehypeRaw from "rehype-raw";

/**
 * Safe parsing of raw HTML embedded in Markdown.
 *
 * AI-written translations often carry a little real markup — most commonly
 * `<br>` inside table cells, which has no Markdown equivalent. Dropping it
 * loses the line break; letting it through unchecked would let the model inject
 * scripts or event handlers into the reader.
 *
 * The two rehype plugins here split the problem cleanly: every element built
 * from Markdown *syntax* is stamped as safe, and everything that arrives as
 * raw HTML afterwards is attribute-whitelisted (and dropped outright for
 * interactive/media tags). The reader and the export writers share both, so
 * an export never contains markup the reader would have refused to render.
 */

interface HastNode {
  type?: string;
  tagName?: unknown;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  /** Text nodes carry their content here. */
  value?: string;
}

/** Attribute names allowed on raw-HTML elements. Anything else — e.g. names
 *  mangled by markdown emphasis inside a tag (`**classname`, `border-**`) —
 *  is dropped so the markup stays valid. */
const RAW_HTML_ATTRIBUTES = new Set([
  "href",
  "src",
  "alt",
  "title",
  "dir",
  "lang",
  "colspan",
  "rowspan",
  "start",
  "style",
]);

/** Tags whose raw-HTML subtrees are discarded entirely (script, media,
 *  interactive controls, …). */
const DROP_RAW_HTML_TAGS = new Set([
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "iframe",
  "input",
  "label",
  "link",
  "meta",
  "noscript",
  "object",
  "option",
  "picture",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "track",
  "video",
]);

/** Marker stamped on every element produced from Markdown syntax (see
 *  `markGeneratedElements`). Raw-HTML elements parsed later by `rehypeRaw`
 *  never carry it, so the sanitizer can tell the two apart — even though
 *  `rehypeRaw` rebuilds node identities (the marker travels as a `data-*`
 *  attribute through its HTML round-trip). Removed again by the sanitizer, so
 *  it never reaches React or the exported HTML. */
const GENERATED_MARKER = "dataReadlynxSafe";

/** Runs before `rehypeRaw`: every element in the tree at this point was
 *  produced from Markdown syntax (raw HTML is still unparsed `raw` nodes),
 *  so stamp them for the sanitizer below. */
export function markGeneratedElements(): (tree: HastNode) => void {
  const walk = (node: HastNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element") {
      node.properties = { ...(node.properties ?? {}), [GENERATED_MARKER]: "true" };
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  return walk;
}

/** Sanitizes the raw-HTML tree produced by `rehypeRaw`.
 *
 *  Elements stamped by `markGeneratedElements` keep their attributes
 *  (stripping them would kill code highlighting, KaTeX styling and task-list
 *  checkboxes) — only the marker itself is removed, and their children are
 *  still visited since raw HTML can nest inside them. */
export function sanitizeRawHtml(): (tree: HastNode) => void {
  const walk = (node: HastNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element") {
      const props = node.properties;
      if (props && props[GENERATED_MARKER] !== undefined) {
        delete props[GENERATED_MARKER];
      } else {
        const tag = String(node.tagName ?? "").toLowerCase();
        if (DROP_RAW_HTML_TAGS.has(tag)) {
          node.tagName = "span";
          node.properties = {};
          node.children = [];
          return;
        }
        if (props) {
          for (const name of Object.keys(props)) {
            if (!RAW_HTML_ATTRIBUTES.has(name)) {
              delete props[name];
            }
          }
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  return walk;
}

/** The rehype chain that parses and then sanitizes embedded HTML. Every
 *  export consumer and the reader's raw-HTML mode use it, and the math repair
 *  runs last so it sees the final tree. */
export const REHYPE_SAFE_HTML = [
  markGeneratedElements,
  rehypeRaw,
  sanitizeRawHtml,
  decodeMathEntities,
];

/**
 * Rehype chain for content whose markup must stay *text*.
 *
 * The escaping happens first, in the source (see `escapeHtmlInMarkdown`), so
 * the only real element the parser can find is the `<br>` that escaping
 * deliberately spared — the one tag with no meaning as literal text and no
 * Markdown equivalent, which a table cell needs. No sanitizer is required
 * here: a tag that never survived the escape never reaches the tree.
 */
export const REHYPE_LINE_BREAKS_ONLY = [rehypeRaw, decodeMathEntities];

/** HTML entities a model may emit instead of the character itself. */
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|#(\d+)|#[xX]([0-9a-fA-F]+));/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeOnePass(value: string): string {
  return value.replace(ENTITY_RE, (match, dec: string | undefined, hex: string | undefined) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED_ENTITIES[match.slice(1, -1).toLowerCase()] ?? match;
  });
}

/** How many times the decoder re-scans its own output. Escaping is not a
 *  one-off: the model writes `&lt;`, the source escaper turns that into
 *  `&amp;lt;`, and that is what reaches KaTeX. Stopping after one pass would
 *  yield `&lt;`, which KaTeX still rejects, so the repair has to run until the
 *  text stops changing. Three passes covers realistic double and triple
 *  escaping; the cap just bounds a pathological input. */
const MAX_DECODE_PASSES = 3;

/** Decodes entities to a fixed point: `&amp;lt;` → `&lt;` → `<`. */
function decodeEntities(value: string): string {
  let out = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodeOnePass(out);
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** Tag names `remark-math` gives the math nodes it creates. Display math is
 *  `math`; inline math is `inline-math` with a hyphen, as `mdast-util-to-hast`
 *  spells it. Matching the camelCase `inlineMath` from the *mdast* node type
 *  instead silently skips every `$…$` formula. */
const MATH_TAGS = new Set(["math", "inline-math", "inlineMath"]);

/**
 * Repairs math that arrives HTML-escaped.
 *
 * Models routinely write `\text{a} &lt; 1` instead of `\text{a} < 1`, because
 * they are producing HTML, not TeX. KaTeX then chokes on the literal `&` and
 * renders a red `katex-error` span. Decoding the entities inside math nodes
 * only (never in prose, where `&lt;` legitimately means a `<`) turns the
 * expression back into what the author meant.
 */
export function decodeMathEntities() {
  const walk = (node: HastNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    const isMath =
      node.type === "element" && MATH_TAGS.has(String(node.tagName ?? "").toLowerCase());
    if (isMath) {
      const decode = (target: HastNode | undefined): void => {
        if (!target || typeof target !== "object") return;
        if (target.type === "text" && typeof target.value === "string") {
          target.value = decodeEntities(target.value);
          return;
        }
        if (Array.isArray(target.children)) {
          for (const child of target.children) decode(child);
        }
      };
      decode(node);
      return;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  return walk;
}

