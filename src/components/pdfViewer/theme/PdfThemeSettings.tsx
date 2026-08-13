import { X } from "lucide-react";
import { Button } from "../../ui/Button/Button";
import { ColorSelect } from "../../ui/ColorSelect/ColorSelect";
import { usePdfTheme } from "./PdfThemeContext";
import { PDF_THEME_BACKGROUNDS } from "./PdfThemeManager";
import styles from "./PdfThemeSettings.module.css";

interface PdfThemeSettingsProps {
  open: boolean;
  onClose: () => void;
}

/** The full palette shown in the custom-color picker: the curated
 *  easy-on-the-eyes backgrounds plus a soft paper ramp. */
const BACKGROUND_PRESETS = [
  ...PDF_THEME_BACKGROUNDS.map(({ background }) => background),
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

/** Reading-background popover: a curated palette of eye-friendly colors plus
 *  a custom color picker. All changes are presentation-only — the PDF file
 *  itself is never modified. */
export function PdfThemeSettings({ open, onClose }: PdfThemeSettingsProps) {
  const { state, setBackground, reset } = usePdfTheme();
  if (!open) return null;

  return (
    <div className={`${styles.panel} pdf-toolbar-popover`} role="dialog" aria-label="PDF reading background">
      <header className={styles.header}>
        <span className={styles.headerTitle}>Reading background</span>
        <Button
          variant="icon"
          className={styles.close}
          onClick={onClose}
          aria-label="Close theme panel"
        >
          <X size={15} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </header>

      <p className={styles.hint}>
        Easy-on-the-eyes backgrounds — the document only changes on screen, never in the file.
      </p>

      <div className={styles.group}>
        <span className={styles.label}>Palette</span>
        <div className={styles.palette} role="radiogroup" aria-label="Background palette">
          {PDF_THEME_BACKGROUNDS.map(({ name, background }) => {
            const active = state.background.toLowerCase() === background;
            return (
              <button
                key={background}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={name}
                title={name}
                className={`${styles.paletteSwatch} ${active ? styles.paletteActive : ""}`}
                style={{ background }}
                onClick={() => setBackground(background)}
              />
            );
          })}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Custom color</span>
        <ColorSelect
          value={state.background}
          onChange={setBackground}
          presets={BACKGROUND_PRESETS}
          label="Background color"
        />
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.resetButton} onClick={reset}>
          Reset to default background
        </button>
      </footer>
    </div>
  );
}