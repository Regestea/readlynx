import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";
import { $patchStyleText } from "@lexical/selection";
import { useDefaultFont, useToolbarState } from "../context";
import { getInstalledFonts } from "../utils/systemFonts";
import styles from "./FontFamilySelect.module.css";

interface FontOption {
  value: string;
  label: string;
}

const CURATED_OPTIONS: FontOption[] = [
  { value: "", label: "Default" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Times New Roman, serif", label: "Times New Roman" },
  { value: "Courier New, monospace", label: "Courier New" },
  { value: "Vazirmatn, Tahoma, sans-serif", label: "Vazirmatn (فارسی)" },
  { value: "Noto Sans Arabic, Segoe UI, sans-serif", label: "Noto Arabic (العربية)" },
];

function labelForValue(value: string): string {
  if (!value) return "Default";
  const curated = CURATED_OPTIONS.find((option) => option.value === value);
  if (curated) return curated.label;
  return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

export function FontFamilySelect() {
  const [editor] = useLexicalComposerContext();
  const state = useToolbarState();
  const { defaultFontFamily, setDefaultFontFamily } = useDefaultFont();
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getInstalledFonts().then((fonts) => {
      if (!cancelled) setInstalled(fonts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const options = useMemo(() => {
    const known = new Set(CURATED_OPTIONS.map((option) => option.value));
    const system = installed
      .filter((family) => !known.has(family))
      .map((family) => ({ value: family, label: family }));
    const all = [...CURATED_OPTIONS, ...system];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (option) =>
        option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q),
    );
  }, [installed, query]);

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

  const label = labelForValue(state.fontFamily);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.select}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Font family: ${label}`}
        onClick={() => {
          if (!open) setQuery("");
          setOpen((prev) => !prev);
        }}
      >
        <span className={`${styles.selectLabel} ${state.fontFamily ? "" : styles.selectLabelDefault}`}>
          {label}
        </span>
        <ChevronDown size={12} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.panel} role="listbox" aria-label="Font family">
          <input
            ref={searchRef}
            type="text"
            className={styles.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search fonts…"
            aria-label="Search fonts"
          />
          <div className={styles.list}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={state.fontFamily === option.value}
                className={[
                  styles.option,
                  state.fontFamily === option.value ? styles.optionActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={option.value ? { fontFamily: option.value } : undefined}
                title={option.label}
                onClick={() => applyFont(option.value)}
              >
                <span className={styles.optionCheck}>
                  {state.fontFamily === option.value ? <Check size={13} /> : null}
                </span>
                <span className={styles.optionName}>{option.label}</span>
              </button>
            ))}
            {options.length === 0 && <div className={styles.empty}>No fonts match “{query}”</div>}
          </div>
          <div className={styles.footer}>
            <button
              type="button"
              className={[
                styles.footerButton,
                defaultFontFamily === state.fontFamily ? styles.footerButtonActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={defaultFontFamily === state.fontFamily}
              title="Use this font for newly typed text that has no explicit font"
              onClick={() => setAsDefault(state.fontFamily || "sans-serif")}
            >
              Set as default
            </button>
            {defaultFontFamily && (
              <span className={styles.defaultTag} title={labelForValue(defaultFontFamily)}>
                Default: {labelForValue(defaultFontFamily)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
