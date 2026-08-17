import { X } from "lucide-react";
import { Button } from "../Button/Button";
import { ColorSelect } from "../ColorSelect/ColorSelect";
import { READING_BACKGROUND_PRESETS, READING_BACKGROUNDS } from "./colors";
import type { ColorSwatch } from "./colors";
import styles from "./ColorPickerPanel.module.css";

export type { ColorSwatch } from "./colors";

/** One pickable color group inside the panel: a label, an optional quick
 *  palette grid, and a swatch row with a custom color input. The curated
 *  reading colors are always included — `presets` only adds on top of them. */
export interface ColorPickerSection {
  /** Stable key for React reconciliation. */
  id: string;
  /** Label shown above the swatches (e.g. "Text color"). */
  label: string;
  /** Currently applied color. */
  value: string;
  /** Called with the picked color ("" = none, when `noneLabel` is set). */
  onChange: (color: string) => void;
  /** Extra preset swatches appended after the built-in curated set. */
  presets?: string[];
  /** Quick-palette grid rendered above the swatch row; defaults to the
   *  curated reading backgrounds. Pass `null` to hide the grid. */
  palette?: ColorSwatch[] | null;
  /** Label for the "no color" (empty value) swatch; hidden when omitted. */
  noneLabel?: string;
}

interface ColorPickerPanelProps {
  open: boolean;
  onClose: () => void;
  /** Dialog title shown in the header. */
  title?: string;
  /** Helper text under the header. */
  hint?: string;
  /** The color groups rendered in the panel. */
  sections: ColorPickerSection[];
  /** Footer action label (e.g. "Reset to theme"); hidden when omitted. */
  resetLabel?: string;
  /** Footer action. */
  onReset?: () => void;
  /** Which edge of the trigger the panel opens from. */
  align?: "left" | "right";
  className?: string;
}

/** Shared color picker popover used by the PDF theme panel, the Markdown and
 *  EPUB reader toolbars and the document editor's Colors menu. Every section
 *  ships with the curated reading colors (palette grid + preset row) by
 *  default, so the same colors are available in every reader; callers only
 *  add their own extras when needed. */
export function ColorPickerPanel({
  open,
  onClose,
  title,
  hint,
  sections,
  resetLabel,
  onReset,
  align = "left",
  className,
}: ColorPickerPanelProps) {
  if (!open) return null;

  return (
    <div
      className={[
        styles.panel,
        align === "right" ? styles.panelRight : styles.panelLeft,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-label={title ?? "Pick a color"}
    >
      {title && (
        <header className={styles.header}>
          <span className={styles.headerTitle}>{title}</span>
          <Button
            variant="icon"
            className={styles.close}
            onClick={onClose}
            aria-label="Close color panel"
          >
            <X size={15} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </header>
      )}

      {hint && <p className={styles.hint}>{hint}</p>}

      {sections.map((section) => {
        const palette = section.palette === null ? [] : section.palette ?? READING_BACKGROUNDS;
        // Colors already shown in the palette grid above are not repeated in
        // the preset row.
        const gridColors = new Set(palette.map(({ color }) => color.toLowerCase()));
        const presets = Array.from(
          new Set([...READING_BACKGROUND_PRESETS, ...(section.presets ?? [])]),
        ).filter((color) => !gridColors.has(color.toLowerCase()));
        return (
          <div key={section.id} className={styles.group}>
            <span className={styles.label}>{section.label}</span>
            {palette.length > 0 && (
              <div className={styles.palette} role="radiogroup" aria-label={section.label}>
                {palette.map(({ name, color }) => {
                  const active = section.value.toLowerCase() === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={name ?? color}
                      title={name ?? color}
                      className={`${styles.paletteSwatch} ${active ? styles.paletteActive : ""}`}
                      style={{ background: color }}
                      onClick={() => section.onChange(color)}
                    />
                  );
                })}
              </div>
            )}
            <div className={styles.swatchRow}>
              {section.noneLabel && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={section.value === ""}
                  aria-label={section.noneLabel}
                  title={section.noneLabel}
                  className={`${styles.noneSwatch} ${section.value === "" ? styles.swatchActive : ""}`}
                  onClick={() => section.onChange("")}
                />
              )}
              <ColorSelect
                value={section.value}
                onChange={section.onChange}
                presets={presets}
                label={section.label}
              />
            </div>
          </div>
        );
      })}

      {resetLabel && onReset && (
        <footer className={styles.footer}>
          <button type="button" className={styles.resetButton} onClick={onReset}>
            {resetLabel}
          </button>
        </footer>
      )}
    </div>
  );
}