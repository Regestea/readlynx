/**
 * Repairs Mermaid sources that a model produced but Mermaid cannot parse.
 *
 * Mermaid's grammar is unforgiving about label text. A label delimited by
 * brackets — `B1[Selection Tests (final)]`, `A{Step 1}`, `-->|yes (go on)|` —
 * ends at the *first* closing character it meets, so an unescaped `(`, `[`,
 * `{` or `|` inside the text terminates the label early and the rest of the
 * line is parsed as garbage. The fix Mermaid itself documents is to wrap such
 * a label in double quotes, where `"` is written as the entity `#quot;`.
 *
 * Every repair here is verified by the caller: a candidate is only used if
 * `mermaid.render` accepts it, so a wrong guess can never make a diagram worse
 * than the model's own source, which is always tried first.
 */

/** Characters that terminate a label early, so the label needs quoting. */
const NEEDS_QUOTING = /["()[\]{}|]/;

/** Bracket pairs, used to decide whether a label nests. */
const BRACKET_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

interface Shape {
  readonly open: string;
  readonly close: string;
}

/** Node shapes Mermaid accepts, longest opener first so `((` wins over `(`.
 *  The awkward parallelogram/trapezoid forms are deliberately absent: they are
 *  rare in model output, and mis-detecting one is worse than leaving it to the
 *  error surface. */
const SHAPES: readonly Shape[] = [
  { open: "(((", close: ")))" },
  { open: "((", close: "))" },
  { open: "([", close: "])" },
  { open: "[(", close: "])" },
  { open: "[[", close: "]]" },
  { open: "{{", close: "}}" },
  { open: "[", close: "]" },
  { open: "(", close: ")" },
  { open: "{", close: "}" },
  { open: ">", close: "]" },
];

/** The diagram families whose labels need the treatment. Everything else
 *  (sequence, state, gantt, journey, timeline) takes free text after a colon
 *  and already tolerates parentheses, so rewriting it would only risk damage.
 *  `quadrantChart` is handled separately: its labels are not bracketed at
 *  all, so the scanner below would never see them. */
const DELIMITED_LABEL_KINDS = new Set([
  "flowchart",
  "graph",
  "class",
  "classdiagram",
  "mindmap",
]);

/** Mermaid's family keyword, read off the first non-comment, non-directive
 *  line: `flowchart TD` -> `flowchart`, `stateDiagram-v2` -> `state`. */
export function mermaidKind(source: string): string {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || line.startsWith("---")) continue;
    const word = /^([A-Za-z]+)/.exec(line)?.[1];
    if (word) return word.toLowerCase();
    break;
  }
  return "";
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/** True when this `>` closes an arrow (`-->`, `-.->`, `==>`) rather than
 *  opening a rhombus label. Node ids may contain `-`, so the distinction has
 *  to be made on the `>` itself. */
function isArrowTail(code: string, at: number): boolean {
  const prev = code[at - 1] ?? "";
  return prev === "-" || prev === "=" || prev === "<" || prev === ">";
}

/** Index just past a `"…"` run, honouring Mermaid's `#quot;` entity so a
 *  quoted label containing one is not cut short. */
function skipQuoted(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    if (code.startsWith("#quot;", i)) {
      i += 6;
      continue;
    }
    if (code[i] === '"') return i + 1;
    i += 1;
  }
  return code.length;
}

function matchShape(code: string, at: number): Shape | null {
  for (const shape of SHAPES) {
    if (code.startsWith(shape.open, at)) return shape;
  }
  return null;
}

/**
 * Index of the character that closes a label opened before `start`, or -1.
 *
 * A label that nests — `((Step (one)))`, `[array [i]]` — must be matched on
 * depth, not on the first closing character, otherwise the label is cut in the
 * middle and the quote we add makes things worse instead of better.
 */
function findLabelEnd(code: string, start: number, shape: Shape): number {
  const openChar = shape.open[0];
  const closeChar = shape.close[0];
  const nests = BRACKET_PAIRS[openChar] === closeChar;
  if (!nests) return code.indexOf(shape.close, start);

  let depth = 1;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"') {
      i = skipQuoted(code, i) - 1;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** How many characters the closing delimiter occupies at `at`, so `[[x]]`
 *  consumes both brackets while `[x]` consumes one. */
function closerLength(code: string, at: number, shape: Shape): number {
  if (code.startsWith(shape.close, at)) return shape.close.length;
  const run = code[at] === shape.close[0] ? 1 : 0;
  return run || shape.close.length;
}

/** Rewrites one label body: quotes it when it contains a character that would
 *  end it early, or (in the aggressive pass) drops those characters instead. */
function rewriteLabel(body: string, aggressive: boolean): string {
  const trimmed = body.trim();
  if (!trimmed) return body;
  // Already quoted, or explicitly markdown-quoted by the model. A quoted label
  // can still be broken from the inside: `A["say "hi" now"]` ends at the
  // second quote, so inner quotes are written as the entity Mermaid expects.
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    const inner = trimmed.slice(1, -1);
    // An existing `#quot;` holds no quote character, so it passes through.
    const escaped = inner.replace(/"/g, "#quot;");
    return escaped === inner ? body : `"${escaped}"`;
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 1) return body;

  if (aggressive) {
    const cleaned = trimmed.replace(/[()[\]{}|]/g, " ").replace(/\s{2,}/g, " ").trim();
    // Never blank a node out; an empty label is a parse error of its own.
    return cleaned || body;
  }
  if (!NEEDS_QUOTING.test(trimmed)) return body;
  return `"${trimmed.replace(/"/g, "#quot;")}"`;
}

/** Quotes delimited node labels and `|edge|` labels on one line of code. */
function repairDelimitedLine(code: string, aggressive: boolean): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    if (ch === '"') {
      const end = skipQuoted(code, i);
      out += code.slice(i, end);
      i = end;
      continue;
    }

    // Edge label: `-->|text|`. Only when the `|` directly follows an arrow,
    // so a pipe elsewhere on the line is left alone.
    if (ch === "|" && /[-=><]/.test(out.trimEnd().slice(-1))) {
      const end = code.indexOf("|", i + 1);
      if (end !== -1) {
        out += `|${rewriteLabel(code.slice(i + 1, end), aggressive)}|`;
        i = end + 1;
        continue;
      }
    }

    // Node label: the shape must follow an identifier directly, which rules
    // out CSS-ish values and the `@{ shape: … }` syntax, and a `>` that is an
    // arrow tail is not a label opener at all.
    const shape = matchShape(code, i);
    if (shape && isIdentChar(out[out.length - 1]) && !(shape.open === ">" && isArrowTail(code, i))) {
      const end = findLabelEnd(code, i + shape.open.length, shape);
      if (end !== -1) {
        const body = code.slice(i + shape.open.length, end);
        const closer = closerLength(code, end, shape);
        out += `${shape.open}${rewriteLabel(body, aggressive)}${code.slice(end, end + closer)}`;
        i = end + closer;
        continue;
      }
    }

    out += ch;
    i += 1;
  }
  return out;
}

/** `pie` requires every slice label to be a quoted string, parens or not. */
function repairPieLine(line: string, aggressive: boolean): string {
  const match = /^(\s*)("[^"]*"|[^:]*?)\s*:\s*([\d.]+.*)$/.exec(line);
  if (!match) return line;
  const [, indent, label, value] = match;
  if (label.trim().startsWith('"')) return line;
  const body = aggressive
    ? label.replace(/[()[\]{}|]/g, " ").replace(/\s{2,}/g, " ").trim()
    : label.trim();
  if (!body) return line;
  return `${indent}"${body.replace(/"/g, "#quot;")}" : ${value}`;
}

/** `erDiagram` relationship labels follow a `:` and break on parentheses, e.g.
 *  `CUSTOMER ||--o{ ORDER : places (many)`. */
function repairErLine(line: string, aggressive: boolean): string {
  if (!/(--|\.\.)/.test(line)) return line;
  const at = line.lastIndexOf(":");
  if (at === -1) return line;
  const label = line.slice(at + 1);
  if (!aggressive && !NEEDS_QUOTING.test(label)) return line;
  const rewritten = rewriteLabel(label, aggressive);
  if (rewritten === label) return line;
  return `${line.slice(0, at + 1)}${rewritten}`;
}

/**
 * `quadrantChart` writes its labels as free text to the end of the line, so
 * the bracket scanner cannot reach them and two model habits break the lexer:
 *
 *  - an axis whose range is wrapped in parentheses — `x-axis A (Low --> High)`.
 *    The arrow is not a token there, so the whole line is a lexical error; the
 *    parentheses just have to come off.
 *  - a quadrant label holding brackets or parentheses, which needs the same
 *    quoting a flowchart label gets. Ampersands and commas are fine.
 */
function repairQuadrantLine(line: string, aggressive: boolean): string {
  const axis = /^(\s*(?:x|y)-axis\s+)(\S.*)$/.exec(line);
  if (axis) {
    const [, head, rest] = axis;
    const unwrapped = rest.replace(/\s*\(([^()]*?-->[^()]*?)\)\s*$/, " $1");
    return unwrapped === rest ? line : head + unwrapped;
  }
  const quadrant = /^(\s*quadrant-[1-4]\s+)(\S.*)$/.exec(line);
  if (quadrant) {
    const [, head, label] = quadrant;
    return head + rewriteLabel(label, aggressive);
  }
  return line;
}

/** Matching bracket pairs, used to tell a mirrored delimiter from a typo. */
const MIRROR_PAIRS: Record<string, string> = { "]": "[", ")": "(", "}": "{" };

/** Undoes the mirroring a model applies when it writes Mermaid around RTL text.
 *
 * Asked for a chart in Persian, a model reliably flips the delimiters to match
 * the visual order of the sentence: `A1[میانگین / Mean]` comes back as
 * `]میانگین / Mean[A1`, and `subgroup title (note)` as `title )note(`. Mermaid
 * is a left-to-right grammar, so those lines are a lexer error and the diagram
 * can only be shown as source.
 *
 * Each rewrite is recognised by a *closing* bracket at the start of the line
 * and a matching opening bracket before the node id at the end, so ordinary
 * declarations are untouched. `openCloser` puts the pair back in logical order
 * rather than dropping it, keeping the author's parenthetical. */
function repairMirroredLine(code: string): string {
  // A node: closer, label, opener, id  ->  id, opener, label, closer.
  const node = /^(\s*)([)\]}])(.+)([([{])([A-Za-z_][\w-]*)\s*$/.exec(code);
  if (node) {
    const [, indent, closer, label, opener, id] = node;
    if (MIRROR_PAIRS[closer] === opener) {
      return `${indent}${id}${opener}${label}${closer}`;
    }
  }
  // A subgraph: `subgraph name )note(`  ->  `subgraph "name (note)"`.
  const subgraph =
    /^(\s*subgraph)\s+(\S+)\s+([)\]}])(.+)([([{])\s*$/.exec(code);
  if (subgraph) {
    const [, keyword, name, closer, label, opener] = subgraph;
    if (MIRROR_PAIRS[closer] === opener) {
      return `${keyword} "${name} ${opener}${label}${closer}"`;
    }
  }
  return code;
}

/**
 * Normalises a `subgraph` header so its title can be parsed.
 *
 * A subgraph title runs to the end of the line, and without brackets there is
 * nothing for the label scanner to hook onto — so a title containing a
 * parenthesis (`subgraph Item Characteristic Curve (ICC)`) is a parse error
 * that no other repair can see. Two shapes are fixed:
 *
 *  - `subgraph id [label]`: the stray space is removed so the label scanner
 *    sees the bracket and can quote the label.
 *  - a bare multi-word title holding a breaking character: the whole title is
 *    quoted, which is how Mermaid expects a title without an id.
 */
function repairSubgraphLine(code: string): string {
  const match = /^(\s*subgraph)\s+(\S.*)$/.exec(code);
  if (!match) return code;
  const [, keyword, rest] = match;
  const trimmed = rest.trim();
  if (trimmed.startsWith('"')) return code;

  // `id [label]` / `id (label)`: close the gap so the label pass can quote it.
  // The bracketed part must be balanced and reach the end of the line. Without
  // that anchor the pattern also matches inside `S1["Group (core)"]`, where the
  // space *inside* the label looks like the separator and gets deleted.
  const spaced = /^(\S+)\s+(\[[^\]]*\]|\([^()]*\)|\{[^{}]*\})$/.exec(trimmed);
  if (spaced) return `${keyword} ${spaced[1]}${spaced[2]}`;

  // `id[label]`: the label pass already owns this one.
  if (/^\S+[[([{]/.test(trimmed)) return code;
  if (!NEEDS_QUOTING.test(trimmed)) return code;
  return `${keyword} "${trimmed.replace(/"/g, "#quot;")}"`;
}

/**
 * Rewrites a Mermaid source so its labels survive the parser.
 *
 * `aggressive` selects the fallback pass, which deletes the offending
 * characters instead of quoting them. The caller must confirm the result with
 * `mermaid.render` before using it.
 */
export function repairMermaidSource(source: string, aggressive = false): string {
  const kind = mermaidKind(source);
  let depth = 0;
  const out = source.split("\n").map((raw) => {
    const commentAt = raw.indexOf("%%");
    const code = commentAt === -1 ? raw : raw.slice(0, commentAt);
    const comment = commentAt === -1 ? "" : raw.slice(commentAt);

    // Undo mirrored delimiters first: the label-quoting pass below can only see
    // a label once it sits between a real opening and closing bracket. A glyph
    // arrow is repaired on the same pass, for the same reason — nothing links
    // until it is a real arrow.
    const unmirrored =
      kind === "flowchart" || kind === "graph" ? repairUnicodeArrows(repairMirroredLine(code)) : repairMirroredLine(code);

    if (kind === "pie") return repairPieLine(unmirrored, aggressive) + comment;
    if (kind === "erdiagram") return repairErLine(unmirrored, aggressive) + comment;
    if (kind === "quadrantchart") return repairQuadrantLine(unmirrored, aggressive) + comment;

    // Inside a `{ … }` body a `(x)` is a parameter list, not a label, so those
    // regions are passed through untouched.
    if (depth === 0 && DELIMITED_LABEL_KINDS.has(kind)) {
      const withSubgraph = kind === "flowchart" || kind === "graph"
        ? repairSubgraphLine(unmirrored)
        : unmirrored;
      const repaired = repairDelimitedLine(withSubgraph, aggressive);
      for (const ch of repaired) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      if (depth < 0) depth = 0;
      return repaired + comment;
    }

    for (const ch of unmirrored) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth < 0) depth = 0;
    return unmirrored + comment;
  });
  return out.join("\n");
}

/** Ordered render attempts: the model's own source first (so a valid diagram
 *  is never rewritten), then the quoting repair, then the lossy one. */
export function mermaidCandidates(raw: string): string[] {
  return [...new Set([raw, repairMermaidSource(raw), repairMermaidSource(raw, true)])];
}

/** Which recovery produced an attempt. */
export type MermaidRecoveryStage = "original" | "quoted" | "stripped" | "pruned" | "structure-only";

export interface MermaidAttempt {
  source: string;
  stage: MermaidRecoveryStage;
  /** True when the repair changed the model's own text. */
  modified: boolean;
}

/** Directives that only add styling or layout hints. A model attaches them
 *  liberally and one of them is enough to make an otherwise fine diagram
 *  unparseable, so they are the cheapest thing to sacrifice. */
const OPTIONAL_DIRECTIVE =
  /^\s*(style\b|linkStyle\b|classDef\b|class\b|direction\b|click\b|accTitle\s*:|accDescr\s*:)/i;

function withoutOptionalDirectives(source: string): string {
  return source
    .split("\n")
    .filter((line) => !OPTIONAL_DIRECTIVE.test(line))
    .join("\n");
}

/** True for a line that declares a node or an edge, as opposed to styling,
 *  structure, a comment or debris. */
function isDeclaration(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (OPTIONAL_DIRECTIVE.test(text)) return false;
  if (/^(subgraph|end|%%|graph\b|flowchart\b|---)/i.test(text)) return false;
  // A leading quote is allowed: quoting is exactly what the repair does, so a
  // repaired `"Dogs (good)" : 1` still has to count as a declaration.
  const names = /^["']?[\p{L}\p{N}_-]+/u.test(text);
  const shapes = /[[({>]/.test(text);
  const links = /-{1,3}[->=]|={2,}>|\.\.>/.test(text);
  return names && (shapes || links);
}

function declarationCount(source: string): number {
  return source.split("\n").filter(isDeclaration).length;
}

/** Last resort: keep the header and only the statements that declare nodes and
 *  edges. Styling, subgraphs, comments and anything unrecognised are dropped,
 *  which turns "no diagram" into "a plain graph of the same nodes". */
function structureOnly(source: string): string {
  const lines = source.split("\n");
  const header = (lines[0] ?? "").trim();
  return [header, ...lines.slice(1).filter(isDeclaration)].join("\n");
}

/** Removes debris that is obviously not part of the grammar, without dropping
 *  whole statements: a stray code fence, a markdown heading, a line of bare
 *  punctuation, and trailing commas or semicolons. */
function stripObviousJunk(source: string): string {
  return source
    .split("\n")
    .map((line) =>
      line
        .replace(/[,;]+\s*$/, "")
        // A comma straight after a closing bracket is debris, not punctuation:
        // `A[x], --> B[y]` is how models trail a declaration.
        .replace(/([)\]}])[,;]+(?=\s|$)/g, "$1")
        // A link with nothing after it (`A[x] -->`) is an unfinished statement.
        .replace(/(?:-{1,3}>?|={2,}>|-\.-|\.\.>)\s*$/, "")
        .replace(/\s+$/, ""),
    )
    .filter((line) => {
      const text = line.trim();
      if (/^`{3,}\s*$/.test(text)) return false;
      if (/^#{2,}\s/.test(text)) return false;
      if (/^[^\p{L}\p{N}]+$/u.test(text)) return false;
      return true;
    })
    .join("\n");
}

/** Arrows a model writes as a glyph. Mermaid only understands its own arrow
 *  syntax, so a line carrying one of these links nothing at all. */
const UNICODE_ARROW = /→|⟶|↔|⇒|⇐/;

/** Rewrites a glyph used as a link into Mermaid's arrow. Only when the line has
 *  no real arrow, so a glyph inside a label such as `A[x → y] --> B` is left
 *  exactly as written. */
function repairUnicodeArrows(code: string): string {
  if (!UNICODE_ARROW.test(code)) return code;
  if (/->|-->|---|==>|-\.-|\.\.>/.test(code)) return code;
  return code.replace(UNICODE_ARROW, "-->");
}

/** Repeatedly drop one line at a time, keeping only the removals that Mermaid
 *  is actually happy with. Needs the parser's verdict, so it cannot be done
 *  blind. Bounded, because a pathological diagram would otherwise cost one
 *  parse per line per attempt. */
async function pruneUntilParsable(
  source: string,
  canParse: (candidate: string) => Promise<boolean>,
  maxRemovals: number,
): Promise<string[]> {
  const accepted: string[] = [];
  let current = source;
  for (let round = 0; round < maxRemovals; round += 1) {
    const lines = current.split("\n");
    let victim = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const candidate = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
      if (await canParse(candidate)) {
        victim = i;
        break;
      }
    }
    if (victim === -1) break;
    lines.splice(victim, 1);
    current = lines.join("\n");
    accepted.push(current);
  }
  return accepted;
}

/** Upper bound on line-removal rounds. Six covers a model that bolted several
 *  bad statements onto an otherwise sound diagram. */
const MAX_PRUNE_ROUNDS = 6;

/**
 * Yields the diagram sources worth rendering, best first, and only those the
 * parser has actually accepted.
 *
 * The earlier candidates came from knowing which shapes models get wrong. This
 * ladder also handles the shapes nobody has seen yet: it asks Mermaid itself
 * what it thinks, and progressively sacrifices styling, then individual
 * statements, then the diagram's structure — so the result is a degraded but
 * readable diagram rather than source text in the book.
 */
export async function* mermaidRecoveryLadder(
  raw: string,
  canParse: (candidate: string) => Promise<boolean>,
): AsyncGenerator<MermaidAttempt> {
  const seen = new Set<string>();
  // Pruning can reach a source that parses but declares nothing, which draws a
  // blank box. A candidate must not be emptier than the model made it.
  const originalDeclarations = declarationCount(raw);
  const usable = (source: string): boolean =>
    declarationCount(source) > 0 || originalDeclarations === 0;
  async function* offer(
    source: string,
    stage: MermaidRecoveryStage,
  ): AsyncGenerator<MermaidAttempt, boolean> {
    if (seen.has(source)) return false;
    seen.add(source);
    if (!usable(source)) return false;
    if (!(await canParse(source))) return false;
    yield { source, stage, modified: source !== raw };
    return true;
  }

  // 1-3: the source as written, then the two targeted repairs.
  if ((yield* offer(raw, "original"))) return;
  if ((yield* offer(repairMermaidSource(raw), "quoted"))) return;
  if ((yield* offer(repairMermaidSource(raw, true), "stripped"))) return;

  // 4: drop styling and layout directives, then obvious debris.
  const repaired = repairMermaidSource(raw);
  if ((yield* offer(withoutOptionalDirectives(repaired), "pruned"))) return;
  if ((yield* offer(stripObviousJunk(withoutOptionalDirectives(repaired)), "pruned"))) return;

  // 5: let the parser name the offending lines.
  for (const pruned of await pruneUntilParsable(
    stripObviousJunk(withoutOptionalDirectives(repaired)),
    canParse,
    MAX_PRUNE_ROUNDS,
  )) {
    if ((yield* offer(pruned, "pruned"))) return;
  }

  // 6: keep only node and edge statements.
  yield* offer(structureOnly(repaired), "structure-only");
}
