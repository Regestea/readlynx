import katex from "katex";
import { ImportedXmlComponent } from "docx";
import type { XmlComponent } from "docx";

/**
 * LaTeX -> OMML (Office Math Markup Language) for the DOCX writers.
 *
 * A `.docx` is a Word file, not a browser: it has no KaTeX, no woff2 math
 * fonts and no CSS, so the `.katex` spans the PDF path relies on collapse into
 * a pile of meaningless text. Word's own answer is a math zone (`<m:oMath>`),
 * which is what this module builds — so equations arrive as real, editable,
 * selectable Word equations instead of raw LaTeX.
 *
 * The conversion goes through KaTeX's MathML output rather than its LaTeX
 * parser or its HTML renderer:
 *
 *  - MathML is Unicode all the way down, so `\to` arrives as `→` and no
 *    symbol table has to be maintained here;
 *  - it already carries the typographic intent in `mathvariant`
 *    (bold/italic/double-struck/script), which maps onto OMML run properties;
 *  - and it is produced by the very same KaTeX build that renders the PDF, so
 *    anything KaTeX can typeset here can be described.
 *
 * `docx`'s own math classes are not used: `MathRun` accepts text only, so it
 * cannot express `\mathbf`, `\mathbb` or upright operators, and it has no
 * matrix, box or group-character elements. Raw `ImportedXmlComponent`s give
 * the full OMML vocabulary. The `m:` namespace is already declared on the
 * `w:document` element the library writes.
 */

type OmmlChild = ImportedXmlComponent | string;

function om(
  name: string,
  attrs?: Record<string, string>,
  children: OmmlChild[] = [],
): ImportedXmlComponent {
  const element = new ImportedXmlComponent(
    name,
    attrs && Object.keys(attrs).length > 0 ? attrs : undefined,
  );
  for (const child of children) element.push(child);
  return element;
}

/* ---------- Unicode math alphabets ---------- */

/** Word's math font already contains these; mapping the ASCII letter onto its
 *  Mathematical Alphanumeric codepoint is the portable way to get `\mathbb`,
 *  `\mathcal` and `\mathfrak` to look right in every reader. */
const MATH_ALPHABET: Record<string, Record<string, string>> = {
  "double-struck": {
    C: "ℂ",
    H: "ℍ",
    N: "ℕ",
    P: "ℙ",
    Q: "ℚ",
    R: "ℝ",
    Z: "ℤ",
  },
  script: {
    B: "ℬ",
    E: "ℰ",
    F: "ℱ",
    H: "ℋ",
    I: "ℐ",
    L: "ℒ",
    M: "ℳ",
    R: "ℛ",
    e: "ℯ",
    g: "ℊ",
    o: "ℴ",
  },
  fraktur: {
    C: "ℭ",
    H: "ℌ",
    I: "ℑ",
    R: "ℜ",
    Z: "ℨ",
  },
};

/** First code point of each Mathematical Alphanumeric run, per alphabet. */
const ALPHABET_BASE: Record<string, { upper: number; lower: number }> = {
  "double-struck": { upper: 0x1d538, lower: 0x1d552 },
  script: { upper: 0x1d49c, lower: 0x1d4b6 },
  fraktur: { upper: 0x1d504, lower: 0x1d51e },
};

function toAlphabetic(text: string, alphabet: string): string {
  const base = ALPHABET_BASE[alphabet] ?? { upper: 0, lower: 0 };
  const exceptions = MATH_ALPHABET[alphabet] ?? {};
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char >= "A" && char <= "Z") {
      out += exceptions[char] ?? String.fromCodePoint(base.upper + (code - 65));
      continue;
    }
    if (char >= "a" && char <= "z") {
      out += exceptions[char] ?? String.fromCodePoint(base.lower + (code - 97));
      continue;
    }
    out += char;
  }
  return out;
}

/* ---------- Run properties ---------- */

type MathStyle = "p" | "b" | "i" | "bi";

const SANS_FONT = "Segoe UI";
const MONO_FONT = "Consolas";

interface RunStyle {
  /** OMML math style; absent means the math-zone default (italic variables). */
  sty?: MathStyle;
  /** "Normal text": Word draws it in the body font, not the math font. */
  nor?: boolean;
  font?: string;
  color?: string;
}

interface VariantStyle {
  sty?: MathStyle;
  font?: string;
  /** Alphabet to substitute, for the styles with no font of their own. */
  alphabet?: string;
  nor?: boolean;
}

const MATH_VARIANTS: Record<string, VariantStyle> = {
  normal: { sty: "p" },
  text: { sty: "p", nor: true },
  bold: { sty: "b" },
  italic: { sty: "i" },
  "bold-italic": { sty: "bi" },
  "double-struck": { sty: "p", alphabet: "double-struck" },
  script: { sty: "p", alphabet: "script" },
  "bold-script": { sty: "b", alphabet: "script" },
  fraktur: { sty: "p", alphabet: "fraktur" },
  "bold-fraktur": { sty: "b", alphabet: "fraktur" },
  "sans-serif": { sty: "p", font: SANS_FONT },
  "sans-serif-italic": { sty: "i", font: SANS_FONT },
  "sans-serif-bold": { sty: "b", font: SANS_FONT },
  "sans-serif-bold-italic": { sty: "bi", font: SANS_FONT },
  monospace: { sty: "p", font: MONO_FONT },
};

function mathRun(text: string, style: RunStyle): ImportedXmlComponent {
  const mathProps: OmmlChild[] = [];
  if (style.nor) mathProps.push(om("m:nor"));
  if (style.sty) mathProps.push(om("m:sty", { "m:val": style.sty }));
  const runProps: OmmlChild[] = [];
  // The math zone already defaults to the math font; only the styles that need
  // a different family (sans-serif, monospace) ask for one explicitly.
  if (style.font) {
    runProps.push(
      om("w:rFonts", { "w:ascii": style.font, "w:hAnsi": style.font, "w:cs": style.font }),
    );
  }
  if (style.sty === "b" || style.sty === "bi") runProps.push(om("w:b"));
  if (style.sty === "i" || style.sty === "bi") runProps.push(om("w:i"));
  if (style.color) runProps.push(om("w:color", { "w:val": style.color }));
  return om("m:r", {}, [
    ...(mathProps.length > 0 ? [om("m:rPr", {}, mathProps)] : []),
    ...(runProps.length > 0 ? [om("w:rPr", {}, runProps)] : []),
    om("m:t", { "xml:space": "preserve" }, [text]),
  ]);
}

/* ---------- CSS colours KaTeX accepts in \color{...} ---------- */

const NAMED_COLORS: Record<string, string> = {
  black: "000000",
  silver: "C0C0C0",
  gray: "808080",
  grey: "808080",
  white: "FFFFFF",
  maroon: "800000",
  red: "FF0000",
  purple: "800080",
  fuchsia: "FF00FF",
  magenta: "FF00FF",
  green: "008000",
  lime: "00FF00",
  olive: "808000",
  yellow: "FFFF00",
  navy: "000080",
  blue: "0000FF",
  teal: "008080",
  aqua: "00FFFF",
  cyan: "00FFFF",
  orange: "FFA500",
  pink: "FFC0CB",
  brown: "A52A2A",
  darkred: "8B0000",
  darkblue: "00008B",
  darkgreen: "006400",
  darkgray: "A9A9A9",
  darkgrey: "A9A9A9",
  lightgray: "D3D3D3",
  lightgrey: "D3D3D3",
  transparent: "FFFFFF",
};

function toWordColor(value: string): string | undefined {
  const raw = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const digits = hex[1];
    return (digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits).toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return NAMED_COLORS[raw.toLowerCase()];
}

/* ---------- Structural elements ---------- */

function argument(children: OmmlChild[]): ImportedXmlComponent {
  return om("m:e", {}, children);
}

function fraction(num: OmmlChild[], den: OmmlChild[], bar: boolean): ImportedXmlComponent {
  return om("m:f", {}, [
    om("m:fPr", {}, [om("m:type", { "m:val": bar ? "bar" : "noBar" })]),
    om("m:num", {}, num),
    om("m:den", {}, den),
  ]);
}

function radical(deg: OmmlChild[] | null, body: OmmlChild[]): ImportedXmlComponent {
  return om("m:rad", {}, [
    om("m:radPr", {}, [om("m:degHide", { "m:val": deg ? "0" : "1" })]),
    om("m:deg", {}, deg ?? []),
    argument(body),
  ]);
}

function scripts(
  base: OmmlChild[],
  sub: OmmlChild[] | null,
  sup: OmmlChild[] | null,
): ImportedXmlComponent {
  if (sub && sup) {
    return om("m:sSubSup", {}, [argument(base), om("m:sub", {}, sub), om("m:sup", {}, sup)]);
  }
  if (sup) return om("m:sSup", {}, [argument(base), om("m:sup", {}, sup)]);
  return om("m:sSub", {}, [argument(base), om("m:sub", {}, sub ?? [])]);
}

function accent(chr: string, body: OmmlChild[]): ImportedXmlComponent {
  return om("m:acc", {}, [
    om("m:accPr", {}, [om("m:chr", { "m:val": chr })]),
    argument(body),
  ]);
}

function bar(position: "top" | "bot", body: OmmlChild[]): ImportedXmlComponent {
  return om("m:bar", {}, [
    om("m:barPr", {}, [om("m:pos", { "m:val": position })]),
    argument(body),
  ]);
}

function limit(
  name: "m:limLow" | "m:limUpp",
  body: OmmlChild[],
  bound: OmmlChild[],
): ImportedXmlComponent {
  return om(name, {}, [argument(body), om("m:lim", {}, bound)]);
}

/** `\overbrace` / `\underbrace`: a brace drawn above or below the base, with
 *  an optional script on the outside. */
function groupChar(
  position: "top" | "bot",
  base: OmmlChild[],
  sub: OmmlChild[] | null,
  sup: OmmlChild[] | null,
): ImportedXmlComponent {
  return om("m:groupChr", {}, [
    om("m:groupChrPr", {}, [
      om("m:chr", { "m:val": position === "top" ? "⏞" : "⏟" }),
      om("m:pos", { "m:val": position }),
      om("m:vertJc", { "m:val": position }),
    ]),
    argument(base),
    ...(sub ? [om("m:sub", {}, sub)] : []),
    ...(sup ? [om("m:sup", {}, sup)] : []),
  ]);
}

function delimiter(
  begin: string,
  end: string,
  separators: string[],
  body: OmmlChild[],
): ImportedXmlComponent {
  return om("m:d", {}, [
    om("m:dPr", {}, [
      om("m:begChr", { "m:val": begin }),
      ...(separators.length > 0 ? [om("m:sepChr", { "m:val": separators[0] })] : []),
      om("m:endChr", { "m:val": end }),
      om("m:grow", { "m:val": "1" }),
      om("m:ctrlPr"),
    ]),
    // OMML delimiters hold a list of arguments, one per separator.
    ...body.map((child) => argument([child])),
  ]);
}

function nary(chr: string, sub: OmmlChild[] | null, sup: OmmlChild[] | null, body: OmmlChild[]) {
  return om("m:nary", {}, [
    om("m:naryPr", {}, [
      om("m:chr", { "m:val": chr }),
      // Large operators stack their limits above and below, as TeX does.
      om("m:limLoc", { "m:val": "undOvr" }),
      om("m:grow", { "m:val": "1" }),
      ...(sub ? [] : [om("m:subHide", { "m:val": "1" })]),
      ...(sup ? [] : [om("m:supHide", { "m:val": "1" })]),
      om("m:ctrlPr"),
    ]),
    om("m:sub", {}, sub ?? []),
    om("m:sup", {}, sup ?? []),
    argument(body),
  ]);
}

/* ---------- MathML traversal ---------- */

const FUNCTION_APPLICATION = "⁡";

function elementChildren(node: Element): Element[] {
  return Array.from(node.children);
}

function tokenText(node: Element | null): string {
  if (!node) return "";
  if (node.children.length > 0) return "";
  return (node.textContent ?? "").trim();
}

function isFence(node: Element): boolean {
  return node.localName === "mo" && node.getAttribute("fence") === "true";
}

/** An empty end delimiter is spelled "." in MathML, and `\left|` arrives as
 *  the divides sign rather than the bar Word's delimiters use. */
function fenceChar(node: Element): string {
  const text = tokenText(node);
  if (text === ".") return "";
  return text === "∣" ? "|" : text;
}

/** A `\left…\right` (or `pmatrix`/`cases`) row: fences at the two ends of the
 *  row. KaTeX drops a `\right`-less end entirely, so either side may be
 *  missing. */
function delimiterRow(children: Element[]): { begin: string; end: string; body: Element[] } | null {
  if (children.length < 2) return null;
  const begins = isFence(children[0]);
  const last = children[children.length - 1];
  const ends = isFence(last) && !children.slice(1, -1).some(isFence);
  if (!begins && !ends) return null;
  return {
    begin: begins ? fenceChar(children[0]) : "",
    end: ends ? fenceChar(last) : "",
    body: children.slice(begins ? 1 : 0, ends ? children.length - 1 : children.length),
  };
}

/** Signs that take limits (`\sum`, `\int`, `\bigcup`, …) and therefore need
 *  an n-ary object rather than a plain superscript. */
const LARGE_OPERATORS = new Set([
  "∑", "∏", "∐", "∫", "∬", "∭", "∮", "∯", "∰", // ∑ ∏ ∐ ∫ ∬ ∭ ∮ ∯ ∰
  "⋀", "⋁", "⋂", "⋃", // ⋀ ⋁ ⋂ ⋃
  "⨀", "⨁", "⨂", "⨄", "⨅", "⨆", // ⨀ ⨁ ⨂ ⨄ ⨅ ⨆
]);

/** The n-ary sign a scripted base carries, or `null` for anything else. */
function largeOperator(node: Element | null): string | null {
  if (!node || node.localName !== "mo") return null;
  const text = tokenText(node);
  return LARGE_OPERATORS.has(text) ? text : null;
}

/** Spaces `mspace` and `\,` describe in ems, built from the Unicode spaces
 *  Word already carries. */
function spaceText(width: string | null): string {
  if (!width) return "";
  const em = /^(-?[\d.]+)\s*em$/.exec(width.trim());
  if (em) return repeat("\u2003", Math.round(Number(em[1]) * 2));
  const px = /^(-?[\d.]+)\s*(px|pt|mu|ex)$/.exec(width.trim());
  if (!px) return "";
  const value = Number(px[1]);
  const perEm = px[2] === "px" ? 16 : px[2] === "pt" ? 12 : px[2] === "mu" ? 1 / 18 : 0.5;
  return spaceText(`${value / perEm}em`);
}

function repeat(char: string, times: number): string {
  return times > 0 ? char.repeat(Math.min(times, 16)) : "";
}

function matrixColumnGroups(table: Element): { align: string; count: number }[] {
  const declared = (table.getAttribute("columnalign") ?? "").split(/\s+/).filter(Boolean);
  const aligns = declared.length > 0 ? declared : ["center"];
  const groups: { align: string; count: number }[] = [];
  for (const align of aligns) {
    const last = groups[groups.length - 1];
    if (last && last.align === align) last.count += 1;
    else groups.push({ align, count: 1 });
  }
  return groups;
}

function convertTable(table: Element, style: RunStyle): ImportedXmlComponent {
  const rows = elementChildren(table).filter(
    (row) => row.localName === "mtr" || row.localName === "mlabeledtr",
  );
  // KaTeX gives `aligned`/`align` zero column spacing: that is an alignment
  // environment, which OMML models as an equation array rather than a matrix.
  const aligned = (table.getAttribute("columnspacing") ?? "").trim() === "0em";
  const cellsOf = (row: Element) =>
    elementChildren(row)
      .filter((cell) => cell.localName === "mtd")
      .flatMap((cell) => convert(cell, style));
  const body = rows.map((row) => om(aligned ? "m:e" : "m:mr", {}, cellsOf(row)));
  if (aligned) {
    return om("m:eqArr", {}, [
      om("m:eqArrPr", {}, [om("m:baseJc", { "m:val": "center" }), om("m:ctrlPr")]),
      ...body,
    ]);
  }
  const columns = matrixColumnGroups(table);
  return om("m:m", {}, [
    om("m:mPr", {}, [
      om("m:baseJc", { "m:val": columns[0]?.align ?? "center" }),
      om("m:mcs", {},
        columns.map((column) =>
          om("m:mc", {}, [
            om("m:mcPr", {}, [
              om("m:count", { "m:val": String(column.count) }),
              om("m:mcJc", { "m:val": column.align }),
            ]),
          ]),
        ),
      ),
      om("m:ctrlPr"),
    ]),
    ...body,
  ]);
}

/** True when `node` is a brace over/under its first child — the shape
 *  `\overbrace`/`\underbrace` take in MathML. */
function braceMarker(node: Element | null): { position: "top" | "bot"; base: Element } | null {
  if (!node || (node.localName !== "mover" && node.localName !== "munder")) return null;
  const [base, marker] = elementChildren(node);
  if (!base || !marker) return null;
  const char = tokenText(marker);
  if (char !== "⏞" && char !== "⏟") return null;
  if ((node.localName === "munder") !== (char === "⏟")) return null;
  return { position: char === "⏟" ? "bot" : "top", base };
}

function convertOver(el: Element, style: RunStyle): OmmlChild[] {
  const [base, over] = elementChildren(el);
  if (!base) return [];
  // `\overbrace{…}^{…}` arrives with the brace either as the over-script
  // itself or wrapped in its own mover once a script follows it.
  const direct = braceMarker(el);
  if (direct) return [groupChar(direct.position, convert(direct.base, style), null, null)];
  const wrapped = braceMarker(base);
  if (wrapped) {
    return [
      groupChar(
        wrapped.position,
        convert(wrapped.base, style),
        null,
        over ? convert(over, style) : null,
      ),
    ];
  }
  if (el.getAttribute("accent") === "true") {
    const chr = tokenText(over ?? null);
    // `‾` is a line, not an accent: OMML draws that as a bar.
    if (chr === "‾" || chr === "¯") return [bar("top", convert(base, style))];
    return chr ? [accent(chr, convert(base, style))] : convert(base, style);
  }
  if (!over) return convert(base, style);
  return [limit("m:limUpp", convert(base, style), convert(over, style))];
}

function convertUnder(el: Element, style: RunStyle): OmmlChild[] {
  const [base, under] = elementChildren(el);
  if (!base) return [];
  const direct = braceMarker(el);
  if (direct) return [groupChar(direct.position, convert(direct.base, style), null, null)];
  const wrapped = braceMarker(base);
  if (wrapped) {
    return [
      groupChar(
        wrapped.position,
        convert(wrapped.base, style),
        under ? convert(under, style) : null,
        null,
      ),
    ];
  }
  if (el.getAttribute("accentunder") === "true") {
    const chr = tokenText(under ?? null);
    if (chr === "‾" || chr === "¯" || chr === "_") {
      return [bar("bot", convert(base, style))];
    }
    // An accent under the base is the only thing OMML can draw there.
    return chr
      ? [limit("m:limLow", convert(base, style), [accent(chr, [])])]
      : convert(base, style);
  }
  if (!under) return convert(base, style);
  return [limit("m:limLow", convert(base, style), convert(under, style))];
}

function convertUnderOver(el: Element, style: RunStyle): OmmlChild[] {
  const [base, under, over] = elementChildren(el);
  if (!base) return [];
  // Display-mode `\sum_{a}^{b}` arrives here, not as a superscript.
  const operator = largeOperator(base);
  if (operator) return [nary(operator, convert(under, style), convert(over, style), [])];
  const braced = braceMarker(under);
  if (braced) {
    return [
      groupChar(
        braced.position,
        convert(braced.base, style),
        over ? convert(over, style) : null,
        null,
      ),
    ];
  }
  if (!under) return convert(base, style);
  const low = limit("m:limLow", convert(base, style), convert(under, style));
  return over ? [limit("m:limUpp", [low], convert(over, style))] : [low];
}

function convertToken(el: Element, style: RunStyle): OmmlChild[] {
  // `\overset` / `\stackrel` nest markup inside a token element; unwrap it.
  if (el.children.length > 0) return convertRow(el, style);
  if (el.localName === "mtext") {
    const text = el.textContent ?? "";
    if (!text) return [];
    // `\,` and `\;` arrive as a whitespace-only mtext; keeping those in the
    // body font would space them wrongly inside a math zone.
    return [mathRun(text, /^\s+$/.test(text) ? { ...style, sty: "p" } : { ...style, sty: "p", nor: true })];
  }
  if (el.localName === "mspace") {
    const text = spaceText(el.getAttribute("width") ?? el.getAttribute("height"));
    return text ? [mathRun(text, { ...style, sty: "p" })] : [];
  }
  if (el.localName === "ms") return [];

  const text = el.textContent ?? "";
  if (!text) return [];
  if (text === FUNCTION_APPLICATION) return [];

  if (el.localName === "mo") {
    return [mathRun(text, { ...style, sty: "p" })];
  }

  const variant = el.getAttribute("mathvariant");
  const variantStyle = variant ? MATH_VARIANTS[variant] : undefined;
  if (variantStyle) {
    const shaped = variantStyle.alphabet ? toAlphabetic(text, variantStyle.alphabet) : text;
    return [
      mathRun(shaped, {
        sty: variantStyle.sty,
        nor: variantStyle.nor,
        font: variantStyle.font,
        color: style.color,
      }),
    ];
  }
  if (el.localName === "mi" && [...text].length > 1) {
    // A multi-character `mi` is a function name, never a product of variables.
    return [mathRun(text, { ...style, sty: "p" })];
  }
  if (el.localName === "mi") {
    const italic = style.sty === undefined;
    return [mathRun(text, { ...style, sty: italic ? undefined : style.sty })];
  }
  return [mathRun(text, { ...style, sty: "p" })];
}

function convertMstyle(el: Element, style: RunStyle): OmmlChild[] {
  const next: RunStyle = { ...style };
  const color = toWordColor(el.getAttribute("mathcolor") ?? "");
  if (color) next.color = color;
  const variant = el.getAttribute("mathvariant");
  if (variant) {
    const variantStyle = MATH_VARIANTS[variant];
    if (variantStyle) {
      if (variantStyle.sty) next.sty = variantStyle.sty;
      if (variantStyle.font) next.font = variantStyle.font;
    }
  }
  return convertAll(elementChildren(el), next);
}

function convertRow(node: Element, style: RunStyle): OmmlChild[] {
  const children = elementChildren(node);
  const row = delimiterRow(children);
  if (row) return [delimiter(row.begin, row.end, [], convertAll(row.body, style))];
  return convertAll(children, style);
}

function convertAll(nodes: Element[], style: RunStyle): OmmlChild[] {
  return nodes.flatMap((node) => convert(node, style));
}

function convert(node: Element, style: RunStyle): OmmlChild[] {
  switch (node.localName) {
    case "math":
    case "mrow":
      return convertRow(node, style);
    case "semantics":
      return convertAll(elementChildren(node), style);
    case "annotation":
    case "mphantom":
    case "mprescripts":
      return [];
    case "mstyle":
      return convertMstyle(node, style);
    case "mi":
    case "mn":
    case "mo":
    case "mtext":
    case "ms":
    case "mspace":
      return convertToken(node, style);
    case "mfrac": {
      const [num, den] = elementChildren(node);
      const noBar = (node.getAttribute("linethickness") ?? "").trim() === "0px";
      return [fraction(convert(num, style), convert(den, style), !noBar)];
    }
    case "msqrt":
      return [radical(null, convertAll(elementChildren(node), style))];
    case "mroot": {
      const [base, deg] = elementChildren(node);
      return [radical(convert(deg, style), convert(base, style))];
    }
    case "msub":
    case "msup":
    case "msubsup": {
      const [base, first, second] = elementChildren(node);
      const sub = node.localName === "msup" ? null : convert(first, style);
      const sup = node.localName === "msub" ? null : convert(second ?? first, style);
      // A scripted large operator is an n-ary object, not a stacked script:
      // that is what makes Word draw the limits above and below the sign.
      const operator = largeOperator(base);
      if (operator) return [nary(operator, sub, sup, [])];
      return [scripts(convert(base, style), sub, sup)];
    }
    case "mover":
      return convertOver(node, style);
    case "munder":
      return convertUnder(node, style);
    case "munderover":
      return convertUnderOver(node, style);
    case "mtable":
      return [convertTable(node, style)];
    case "menclose": {
      const notation = node.getAttribute("notation") ?? "";
      const body = convertAll(elementChildren(node), style);
      // OMML has no struck-through box; a drawn box is the only enclosure it
      // knows, so `\cancel` keeps its content and loses the line.
      return notation.includes("box")
        ? [om("m:borderBox", {}, [argument(body)])]
        : body;
    }
    default:
      return convertAll(elementChildren(node), style);
  }
}

/* ---------- Entry points ---------- */

/** A math zone (`<m:oMath>`) holding the equation, ready to drop into a Word
 *  paragraph. `null` when the source has no readable MathML, so the caller can
 *  fall back to showing the LaTeX source as text. */
function toMathZone(markup: string): XmlComponent | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, "text/html");
  } catch {
    return null;
  }
  const math = doc.querySelector("math");
  if (!math) return null;
  const children = convertAll(elementChildren(math), {});
  if (children.length === 0) return null;
  return om("m:oMath", {}, children);
}

/** KaTeX's MathML rendering of `latex`, as a Word math zone. */
export function latexToOmml(latex: string, displayMode: boolean): XmlComponent | null {
  const source = latex.trim();
  if (!source) return null;
  let markup: string;
  try {
    markup = katex.renderToString(source, {
      displayMode,
      output: "mathml",
      throwOnError: true,
      strict: "ignore",
    });
  } catch {
    return null;
  }
  return toMathZone(markup);
}

/** The LaTeX behind a KaTeX-rendered element, or `null` when the element is
 *  not a rendered equation.
 *
 *  The document editor stamps the source on the element (`data-equation`); a
 *  translated book goes through `rehype-katex`, which keeps the source in the
 *  MathML `<annotation>`. Both are read here so the DOCX writer has one place
 *  to look, whatever produced the HTML. */
export function latexFromKatexElement(el: Element): { latex: string; display: boolean } | null {
  const stamped = el.getAttribute("data-equation");
  if (stamped) {
    return { latex: stamped, display: el.getAttribute("data-equation-inline") !== "true" };
  }
  const rendered = el.classList.contains("katex") ? el : el.querySelector(".katex");
  if (!rendered) return null;
  const annotation = rendered.querySelector('annotation[encoding="application/x-tex"]');
  const latex = annotation?.textContent?.trim();
  if (!latex) return null;
  let node: Element | null = el;
  let display = false;
  while (node) {
    if (node.classList?.contains("katex-display")) display = true;
    node = node.parentElement;
  }
  return { latex, display };
}
