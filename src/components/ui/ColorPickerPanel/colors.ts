/** Shared color sets for the ColorPickerPanel — the curated easy-on-the-eyes
 *  reading colors first shipped in the PDF viewer, now built into the picker
 *  itself so every reader (PDF, EPUB, Markdown, editor) offers the same set. */

export interface ColorSwatch {
  /** Human-readable name shown as the swatch title/aria-label. */
  name?: string;
  /** The color itself. */
  color: string;
}

/** Curated eye-friendly backgrounds: soft, low-glare papers and muted darks.
 *  Same values as the CSS defaults in pdf-theme.css. */
export const READING_BACKGROUNDS: ColorSwatch[] = [
  { name: "Sepia", color: "#f4ecd8" },
  { name: "Cream", color: "#fdf6e3" },
  { name: "Soft green", color: "#dcedc8" },
  { name: "Mint", color: "#d7efe4" },
  { name: "Sky", color: "#e3ecf5" },
  { name: "Cloud", color: "#ececec" },
  { name: "Amber", color: "#f6e7c1" },
  { name: "Dark gray", color: "#242424" },
  { name: "Slate", color: "#232a35" },
  { name: "Night blue", color: "#1b2a41" },
  { name: "Onyx", color: "#101418" },
];

/** The soft paper ramp shown in the preset row below the palette grid. The
 *  curated backgrounds themselves live in the grid above, so they are not
 *  repeated here. */
export const READING_BACKGROUND_PRESETS: string[] = [
  "#fffffe",
  "#fffefa",
  "#fcf8ed",
  "#f5f1e6",
  "#efeae0",
  "#e8e4d9",
  "#e1ddd3",
  "#dbd7cc",
  "#d4d0c6",
  "#cecabf",
  "#c7c3b9",
  "#c1bdb3",
  "#bbb7ac",
  "#b4b0a6",
  "#aeaaa0",
  "#a8a49a",
  "#a6aab4",
  "#a5abb4",
  "#a1aea9",
  "#b3a7a9",
  "#a8aab4",
];

/** The default reading background — a warm, low-glare paper instead of pure
 *  white. */
export const READING_DEFAULT_BACKGROUND = READING_BACKGROUNDS[0].color;