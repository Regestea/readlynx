import { ColorPickerPanel } from "../../ui/ColorPickerPanel/ColorPickerPanel";
import { usePdfTheme } from "./PdfThemeContext";

interface PdfThemeSettingsProps {
  open: boolean;
  onClose: () => void;
}

/** Reading-background popover: the shared curated palette (the eye-friendly
 *  backgrounds built into the ColorPickerPanel) plus a custom color picker.
 *  All changes are presentation-only — the PDF file itself is never
 *  modified. */
export function PdfThemeSettings({ open, onClose }: PdfThemeSettingsProps) {
  const { state, setBackground, reset } = usePdfTheme();

  return (
    <ColorPickerPanel
      open={open}
      onClose={onClose}
      title="Reading background"
      hint="Easy-on-the-eyes backgrounds — the document only changes on screen, never in the file."
      // The trigger sits in the toolbar's left group, so the panel opens
      // towards the middle of the window. Hanging it off the button's right
      // edge would push a third of it past the left of the screen.
      align="left"
      className="pdf-toolbar-popover"
      sections={[
        {
          id: "background",
          label: "Background color",
          value: state.background,
          onChange: setBackground,
        },
      ]}
      resetLabel="Reset to default background"
      onReset={reset}
    />
  );
}