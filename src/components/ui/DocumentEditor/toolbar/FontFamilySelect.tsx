import { useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";
import { $patchStyleText } from "@lexical/selection";
import { useDefaultFont, useToolbarState } from "../context";
import {
  FontFamilySelect as SharedFontFamilySelect,
  labelForFont,
} from "../../FontFamilySelect/FontFamilySelect";
import sharedStyles from "../../FontFamilySelect/FontFamilySelect.module.css";

/** Font used when neither the selection nor a user default is set: the app's
 *  CSS default (`--font-sans`). */
const APP_DEFAULT_FONT_FAMILY = "Inter";

export function FontFamilySelect() {
  const [editor] = useLexicalComposerContext();
  const state = useToolbarState();
  const { defaultFontFamily, setDefaultFontFamily } = useDefaultFont();
  const [open, setOpen] = useState(false);

  const applyFont = (value: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { "font-family": value || null });
      }
    });
    setOpen(false);
  };

  const setAsDefault = (value: string) => {
    setDefaultFontFamily(value);
    applyFont(value);
  };

  const effectiveFamily = state.fontFamily || defaultFontFamily || APP_DEFAULT_FONT_FAMILY;

  return (
    <SharedFontFamilySelect
      value={state.fontFamily}
      fallbackValue={effectiveFamily}
      onSelect={applyFont}
      open={open}
      onOpenChange={setOpen}
      footer={
        <>
          <button
            type="button"
            className={[
              sharedStyles.footerButton,
              defaultFontFamily === state.fontFamily ? sharedStyles.footerButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={defaultFontFamily === state.fontFamily}
            title="Use this font for newly typed text that has no explicit font"
            onClick={() => setAsDefault(state.fontFamily || defaultFontFamily || APP_DEFAULT_FONT_FAMILY)}
          >
            Set as default
          </button>
          {defaultFontFamily && (
            <span className={sharedStyles.defaultTag} title={labelForFont(defaultFontFamily)}>
              Default: {labelForFont(defaultFontFamily)}
            </span>
          )}
        </>
      }
    />
  );
}