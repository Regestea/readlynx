import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CURATED_FONT_OPTIONS, getInstalledFonts } from "../DocumentEditor/utils/systemFonts";
import styles from "./FontFamilySelect.module.css";

/** Shared font picker: a compact dropdown listing the curated options plus
 *  every font installed on the machine, with search. Used by the editor
 *  toolbar and the EPUB reader settings. */
interface FontFamilySelectProps {
  /** Currently applied CSS font-family value ("" = no override). */
  value: string;
  /** Called with the chosen CSS font-family value ("" = no override). */
  onSelect: (value: string) => void;
  /** Family shown in the trigger label while `value` is empty (e.g. the
   *  document's default font). */
  fallbackValue?: string;
  /** Label for the "no override" option ("" value). */
  defaultLabel?: string;
  /** Extra content rendered at the bottom of the panel. */
  footer?: ReactNode;
  /** Search box placeholder. */
  searchPlaceholder?: string;
  /** Controlled open state (optional). */
  open?: boolean;
  /** Called when the panel should open/close (with `open`). */
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export type { FontFamilySelectProps };

// eslint-disable-next-line react-refresh/only-export-components
export const CURATED_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  ...CURATED_FONT_OPTIONS,
];

/** "Times New Roman, serif" -> "Times New Roman"; quoted -> unquoted. */
// eslint-disable-next-line react-refresh/only-export-components
export function labelForFont(value: string): string {
  if (!value) return "";
  const curated = CURATED_OPTIONS.find((option) => option.value === value);
  if (curated) return curated.label;
  return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

export function FontFamilySelect({
  value,
  onSelect,
  fallbackValue,
  defaultLabel = "Default",
  searchPlaceholder = "Search fonts…",
  footer,
  open: openProp,
  onOpenChange,
  className,
}: FontFamilySelectProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      setOpenInternal(next);
    },
    [onOpenChange],
  );
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
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const options = useMemo(() => {
    const base = [{ value: "", label: defaultLabel }, ...CURATED_FONT_OPTIONS];
    const known = new Set(base.map((option) => option.value));
    const system = installed
      .filter((family) => !known.has(family))
      .map((family) => ({ value: family, label: family }));
    const all = [...base, ...system];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (option) =>
        option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q),
    );
  }, [installed, query, defaultLabel]);

  const displayValue = value || fallbackValue || "";
  const label = displayValue ? labelForFont(displayValue) : defaultLabel;

  const handleSelect = (next: string) => {
    onSelect(next);
    setOpen(false);
  };

  return (
    <div className={className ? `${styles.wrapper} ${className}` : styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.select}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label ? `Font family: ${label}` : "Font family"}
        onClick={() => {
          if (!open) setQuery("");
          setOpen(!open);
        }}
      >
        <span className={`${styles.selectLabel} ${value ? "" : styles.selectLabelDefault}`}>
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
            placeholder={searchPlaceholder}
            aria-label="Search fonts"
          />
          <div className={styles.list}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={[
                  styles.option,
                  value === option.value ? styles.optionActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={option.value ? { fontFamily: option.value } : undefined}
                title={option.label}
                onClick={() => handleSelect(option.value)}
              >
                <span className={styles.optionCheck}>
                  {value === option.value ? <Check size={13} /> : null}
                </span>
                <span className={styles.optionName}>{option.label}</span>
              </button>
            ))}
            {options.length === 0 && <div className={styles.empty}>No fonts match “{query}”</div>}
          </div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </div>
      )}
    </div>
  );
}