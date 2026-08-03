/**
 * Enumerate fonts installed on the system.
 *
 * Strategy:
 * 1. `window.queryLocalFonts()` (Chromium/Electron) — best-effort; may prompt
 *    for permission or be unavailable, in which case we fall back.
 * 2. Width-measurement heuristic — render a probe string in each candidate
 *    family and compare the measured width against a generic fallback. A font
 *    is considered installed when its width differs from the fallback's.
 *
 * Results are cached per session.
 */

/** Curated entries (bundled via Fontsource or commonly expected). */
const CURATED_FONTS = ["Inter", "Vazirmatn", "Noto Sans Arabic"];

/* Broad list of fonts shipped with Windows, macOS, and common Linux distros. */
const CANDIDATE_FONTS: string[] = [
  // Windows UI + core
  "Segoe UI",
  "Segoe UI Light",
  "Segoe UI Semibold",
  "Segoe Print",
  "Segoe Script",
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Arial Rounded MT Bold",
  "Times New Roman",
  "Courier New",
  "Calibri",
  "Calibri Light",
  "Cambria",
  "Cambria Math",
  "Candara",
  "Consolas",
  "Constantia",
  "Corbel",
  "Franklin Gothic Medium",
  "Gabriola",
  "Georgia",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "MS Gothic",
  "MS PGothic",
  "MS Sans Serif",
  "MS Serif",
  "MS UI Gothic",
  "Microsoft Himalaya",
  "Microsoft JhengHei",
  "Microsoft JhengHei UI",
  "Microsoft YaHei",
  "Microsoft YaHei UI",
  "Microsoft Yi Baiti",
  "MingLiU",
  "MingLiU-ExtB",
  "PMingLiU",
  "PMingLiU-ExtB",
  "NSimSun",
  "SimSun",
  "SimSun-ExtB",
  "Palatino Linotype",
  "Rockwell",
  "Sitka Banner",
  "Sitka Display",
  "Sitka Heading",
  "Sitka Small",
  "Sitka Subheading",
  "Sitka Text",
  "Tahoma",
  "Trebuchet MS",
  "Verdana",
  "Webdings",
  "Wingdings",
  // Windows optional / Office
  "Aptos",
  "Aptos Display",
  "Aptos Light",
  "Aptos Narrow",
  "Aptos Serif",
  "Aptos Serif Display",
  "Bahnschrift",
  "Baskerville Old Face",
  "Bauhaus 93",
  "Bell MT",
  "Berlin Sans FB",
  "Blackadder ITC",
  "Bodoni MT",
  "Book Antiqua",
  "Bookman Old Style",
  "Bookshelf Symbol 7",
  "Bradley Hand ITC",
  "Britannic Bold",
  "Broadway",
  "Brush Script MT",
  "Californian FB",
  "Calisto MT",
  "Castellar",
  "Centaur",
  "Century",
  "Century Gothic",
  "Century Schoolbook",
  "Chiller",
  "Colonna MT",
  "Comic Sans MS",
  "Cooper Black",
  "Copperplate Gothic Bold",
  "Copperplate Gothic Light",
  "Curlz MT",
  "Edwardian Script ITC",
  "Elephant",
  "Engravers MT",
  "Eras Bold ITC",
  "Eras Demi ITC",
  "Eras Light ITC",
  "Eras Medium ITC",
  "Felix Titling",
  "Footlight MT Light",
  "Forte",
  "Franklin Gothic Book",
  "Franklin Gothic Demi",
  "Franklin Gothic Demi Cond",
  "Franklin Gothic Heavy",
  "Franklin Gothic Medium Cond",
  "Freestyle Script",
  "French Script MT",
  "Garamond",
  "Gigi",
  "Gill Sans MT",
  "Gill Sans MT Condensed",
  "Gill Sans MT Ext Condensed Bold",
  "Gill Sans Ultra Bold",
  "Gloucester MT Extra Condensed",
  "Goudy Old Style",
  "Goudy Stout",
  "Haettenschweiler",
  "Harlow Solid Italic",
  "Harrington",
  "High Tower Text",
  "Hollywood Hills",
  "HoloLens MDL2 Assets",
  "Imprint MT Shadow",
  "Informal Roman",
  "Javanese Text",
  "Jokerman",
  "Juice ITC",
  "Kalinga",
  "Kartika",
  "Khmer UI",
  "KodchiangUPC",
  "Kokila",
  "Kristen ITC",
  "Kunstler Script",
  "Lao UI",
  "Latha",
  "Leelawadee UI",
  "Lucida Bright",
  "Lucida Calligraphy",
  "Lucida Fax",
  "Lucida Handwriting",
  "Lucida Sans",
  "Lucida Sans Typewriter",
  "Magneto",
  "Maiandra GD",
  "Malgun Gothic",
  "Mangal",
  "Marlett",
  "Matura MT Script Capitals",
  "Meiryo",
  "Meiryo UI",
  "Metal",
  "Mistral",
  "Modern No. 20",
  "Mongolian Baiti",
  "Monotype Corsiva",
  "MV Boli",
  "Myanmar Text",
  "Niagara Engraved",
  "Niagara Solid",
  "Nirmala UI",
  "Nyala",
  "OCR A Extended",
  "Old English Text MT",
  "Onyx",
  "Palace Script MT",
  "Papyrus",
  "Parchment",
  "Perpetua",
  "Perpetua Titling MT",
  "Playbill",
  "Poor Richard",
  "Pristina",
  "Rage Italic",
  "Ravie",
  "Ribbon131",
  "Rockwell Condensed",
  "Rockwell Extra Bold",
  "Script MT Bold",
  "Showcard Gothic",
  "Snap ITC",
  "Stencil",
  "Sylfaen",
  "Symbol",
  "Tempus Sans ITC",
  "Traditional Arabic",
  "Tw Cen MT",
  "Tw Cen MT Condensed",
  "Viner Hand ITC",
  "Vivaldi",
  "Vladimir Script",
  "Vrinda",
  "Wide Latin",
  // macOS system fonts
  "SF Pro",
  "SF Pro Display",
  "SF Pro Text",
  "SF Mono",
  "New York",
  "Helvetica",
  "Helvetica Neue",
  "Avenir",
  "Avenir Next",
  "Avenir Next Condensed",
  "Baskerville",
  "Charter",
  "Copperplate",
  "Didot",
  "Futura",
  "Geneva",
  "Gill Sans",
  "Hoefler Text",
  "Marker Felt",
  "Menlo",
  "Monaco",
  "Optima",
  "Palatino",
  "Rockwell",
  "Savoye LET",
  "Times",
  "Trattatello",
  "Zapfino",
  // Linux common
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "FreeSans",
  "FreeSerif",
  "FreeMono",
  "Noto Sans",
  "Noto Sans UI",
  "Noto Serif",
  "Noto Mono",
  "Noto Sans Mono",
  "Noto Sans CJK SC",
  "Noto Sans CJK TC",
  "Noto Sans CJK JP",
  "Noto Sans CJK KR",
  "Noto Sans Hebrew",
  "Noto Sans Arabic",
  "Noto Sans Devanagari",
  "Noto Sans Thai",
  "Ubuntu",
  "Ubuntu Mono",
  "Cantarell",
  "Fira Sans",
  "Fira Mono",
  "Roboto",
  "Roboto Mono",
  "Droid Sans",
  "Droid Serif",
  "Droid Sans Mono",
  "Open Sans",
  "Lato",
  "Source Sans Pro",
  "Source Code Pro",
  "Merriweather",
  "PT Sans",
  "PT Serif",
];

/** Probe text whose glyph widths differ measurably between font families. */
const PROBE_TEXT = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const BASE_STYLE = [
  "position:absolute",
  "visibility:hidden",
  "top:0",
  "left:-9999px",
  "font-size:72px",
  "font-weight:normal",
  "font-style:normal",
  "letter-spacing:normal",
  "white-space:nowrap",
].join(";");

let cachedFonts: string[] | null = null;

function measureWithProbe(family: string, probeFamily: string): number {
  const probe = document.createElement("span");
  probe.style.cssText = `${BASE_STYLE};font-family:${probeFamily}`;
  probe.textContent = PROBE_TEXT;
  const measured = document.createElement("span");
  measured.style.cssText = `${BASE_STYLE};font-family:${family}`;
  measured.textContent = PROBE_TEXT;
  document.body.appendChild(probe);
  document.body.appendChild(measured);
  const probeWidth = probe.getBoundingClientRect().width;
  const measuredWidth = measured.getBoundingClientRect().width;
  probe.remove();
  measured.remove();
  return measuredWidth - probeWidth;
}

function detectViaMeasurement(): string[] {
  const available = new Set<string>();
  // Compare against three generic families so a candidate matching any of
  // them (e.g. an installed fallback) is still treated as present.
  const probes = ["sans-serif", "serif", "monospace"];
  for (const family of [...CURATED_FONTS, ...CANDIDATE_FONTS]) {
    const widths = probes.map((probe) => measureWithProbe(family, probe));
    if (widths.some((width) => width !== 0)) available.add(family);
  }
  return [...available];
}

async function detectViaLocalFonts(): Promise<string[] | null> {
  const query = (
    window as unknown as {
      queryLocalFonts?: () => Promise<{ family: string; fullName?: string }[]>;
    }
  ).queryLocalFonts;
  if (!query) return null;
  try {
    const fonts = await query();
    const names = new Set<string>();
    for (const font of fonts) {
      names.add(font.family);
      if (font.fullName) names.add(font.fullName);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  } catch {
    // Permission denied or unavailable — fall through to measurement.
    return null;
  }
}

export async function getInstalledFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;
  const fromLocal = await detectViaLocalFonts();
  if (fromLocal && fromLocal.length > 0) {
    cachedFonts = fromLocal;
    return fromLocal;
  }
  cachedFonts = detectViaMeasurement();
  return cachedFonts;
}
