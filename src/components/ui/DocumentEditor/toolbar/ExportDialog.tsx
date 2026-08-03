import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileDown, FileOutput, FileText, FileType2 } from "lucide-react";
import { CURATED_FONT_OPTIONS, getInstalledFonts } from "../utils/systemFonts";
import { FONT_SIZE_OPTIONS, TEXT_COLORS } from "../constants";
import { Button } from "../../Button/Button";
import { Modal } from "../../Modal/Modal";
import styles from "./ExportDialog.module.css";

export type ExportFormat = "pdf" | "docx" | "html" | "epub";

export interface ExportSettings {
  format: ExportFormat;
  fontFamily: string;
  fontSize: string;
  textColor: string;
  backgroundColor: string;
  marginMm: number;
}

const DEFAULT_SETTINGS: ExportSettings = {
  format: "pdf",
  fontFamily: "",
  fontSize: "",
  textColor: "",
  backgroundColor: "",
  marginMm: 12.7,
};

const FORMATS: { value: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { value: "pdf", label: "PDF", icon: <FileDown size={14} strokeWidth={1.8} aria-hidden="true" /> },
  { value: "docx", label: "DOCX", icon: <FileOutput size={14} strokeWidth={1.8} aria-hidden="true" /> },
  { value: "html", label: "HTML", icon: <FileText size={14} strokeWidth={1.8} aria-hidden="true" /> },
  { value: "epub", label: "EPUB", icon: <FileType2 size={14} strokeWidth={1.8} aria-hidden="true" /> },
];

interface Template {
  id: string;
  name: string;
  desc: string;
  fontFamily: string;
  fontSize: string;
  textColor: string;
  backgroundColor: string;
  marginMm: number;
}

const TEMPLATES: Template[] = [
  {
    id: "classic",
    name: "Classic",
    desc: "Serif on warm paper",
    fontFamily: "Georgia, serif",
    fontSize: "16px",
    textColor: "#3a2f27",
    backgroundColor: "#faf6ef",
    marginMm: 12.7,
  },
  {
    id: "modern",
    name: "Modern",
    desc: "Sans on clean white",
    fontFamily: "Inter, sans-serif",
    fontSize: "15px",
    textColor: "#1c2433",
    backgroundColor: "#ffffff",
    marginMm: 8,
  },
  {
    id: "editorial",
    name: "Editorial",
    desc: "High-contrast serif",
    fontFamily: "Georgia, serif",
    fontSize: "17px",
    textColor: "#111827",
    backgroundColor: "#f4f4f0",
    marginMm: 20,
  },
  {
    id: "draft",
    name: "Draft",
    desc: "Compact cool blue",
    fontFamily: "",
    fontSize: "13px",
    textColor: "#2b3448",
    backgroundColor: "#eef3f9",
    marginMm: 8,
  },
];

const PAPER_COLORS = [
  { value: "#ffffff", label: "White", swatch: "#ffffff" },
  { value: "#faf6ef", label: "Cream", swatch: "#faf6ef" },
  { value: "#f4f4f0", label: "Stone", swatch: "#f4f4f0" },
  { value: "#eef3f9", label: "Ice", swatch: "#eef3f9" },
  { value: "#fdf6e3", label: "Sand", swatch: "#fdf6e3" },
  { value: "#e9f1ec", label: "Mint", swatch: "#e9f1ec" },
];

const MARGIN_OPTIONS = [
  { value: 8, label: "Narrow" },
  { value: 12.7, label: "Normal" },
  { value: 20, label: "Wide" },
];

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  onExport: (settings: ExportSettings) => void;
  defaultMarginMm?: number;
}

export function ExportDialog({ open, onClose, onExport, defaultMarginMm }: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>(() => ({
    ...DEFAULT_SETTINGS,
    marginMm: defaultMarginMm ?? DEFAULT_SETTINGS.marginMm,
  }));
  const [installed, setInstalled] = useState<string[]>([]);
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const paperColorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getInstalledFonts().then((fonts) => {
      if (!cancelled) setInstalled(fonts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fontOptions = useMemo(() => {
    const known = new Set(CURATED_FONT_OPTIONS.map((option) => option.value));
    return [
      { value: "", label: "Default" },
      ...CURATED_FONT_OPTIONS,
      ...installed
        .filter((family) => !known.has(family))
        .map((family) => ({ value: family, label: family })),
    ];
  }, [installed]);

  const applyTemplate = (template: Template) => {
    setSettings((prev) => ({
      ...prev,
      fontFamily: template.fontFamily,
      fontSize: template.fontSize,
      textColor: template.textColor,
      backgroundColor: template.backgroundColor,
      marginMm: template.marginMm,
    }));
  };

  const activeTemplate = (() => {
    if (!settings.fontFamily && !settings.fontSize && !settings.textColor && !settings.backgroundColor && settings.marginMm === 12.7) {
      return "custom";
    }
    return (
      TEMPLATES.find(
        (template) =>
          template.fontFamily === settings.fontFamily &&
          template.fontSize === settings.fontSize &&
          template.textColor === settings.textColor &&
          template.backgroundColor === settings.backgroundColor &&
          template.marginMm === settings.marginMm,
      )?.id ?? "custom"
    );
  })();

  const patch = (partial: Partial<ExportSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const isCustomColor = (value: string, presets: readonly { value: string }[]): boolean =>
    value !== "" && !presets.some((preset) => preset.value.toLowerCase() === value.toLowerCase());

  const safeHex = (value: string): string =>
    /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";

  const formatLabel = FORMATS.find((format) => format.value === settings.format)?.label ?? "PDF";

  const previewTextColor = settings.textColor || "#1f2430";
  const previewBgColor = settings.backgroundColor || "#ffffff";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export document"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onExport(settings)}>
            <Download size={15} strokeWidth={2} aria-hidden="true" /> Export {formatLabel}
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.settings}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Format</span>
            <div className={styles.tabs} role="group" aria-label="Export format">
              {FORMATS.map(({ value, label, icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.tab} ${settings.format === value ? styles.tabActive : ""}`}
                  aria-pressed={settings.format === value}
                  onClick={() => patch({ format: value })}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Ready-made templates</span>
            <div className={styles.templates}>
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`${styles.template} ${activeTemplate === template.id ? styles.templateActive : ""}`}
                  onClick={() => applyTemplate(template)}
                >
                  <span className={styles.templateName}>
                    {activeTemplate === template.id && (
                      <Check size={13} className={styles.templateCheck} aria-hidden="true" />
                    )}
                    {template.name}
                  </span>
                  <span className={styles.templateDesc}>{template.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Font</span>
            <div className={styles.row}>
              <select
                className={styles.control}
                value={settings.fontFamily}
                title="Font family"
                aria-label="Export font family"
                onChange={(event) => patch({ fontFamily: event.target.value })}
              >
                {fontOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className={styles.control}
                value={settings.fontSize}
                title="Font size"
                aria-label="Export font size"
                onChange={(event) => patch({ fontSize: event.target.value })}
              >
                {FONT_SIZE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Text color</span>
            <div className={styles.swatchRow}>
              {TEXT_COLORS.map(({ value, label, swatch }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.swatch} ${settings.textColor === value ? styles.swatchActive : ""}`}
                  style={{ backgroundColor: swatch }}
                  title={label}
                  aria-label={`Text color ${label}`}
                  onClick={() => patch({ textColor: value })}
                />
              ))}
              <button
                type="button"
                className={`${styles.swatch} ${styles.customSwatch} ${
                  isCustomColor(settings.textColor, TEXT_COLORS) ? styles.swatchActive : ""
                }`}
                title="Custom text color…"
                aria-label="Pick a custom text color"
                onClick={() => textColorInputRef.current?.click()}
              />
              <input
                ref={textColorInputRef}
                type="color"
                className={styles.hiddenColorInput}
                value={safeHex(settings.textColor)}
                onChange={(event) => patch({ textColor: event.target.value })}
              />
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Page color</span>
            <div className={styles.swatchRow}>
              {PAPER_COLORS.map(({ value, label, swatch }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.swatch} ${settings.backgroundColor === value ? styles.swatchActive : ""}`}
                  style={{ backgroundColor: swatch }}
                  title={label}
                  aria-label={`Page color ${label}`}
                  onClick={() => patch({ backgroundColor: value })}
                />
              ))}
              <button
                type="button"
                className={`${styles.swatch} ${styles.customSwatch} ${
                  isCustomColor(settings.backgroundColor, PAPER_COLORS) ? styles.swatchActive : ""
                }`}
                title="Custom page color…"
                aria-label="Pick a custom page color"
                onClick={() => paperColorInputRef.current?.click()}
              />
              <input
                ref={paperColorInputRef}
                type="color"
                className={styles.hiddenColorInput}
                value={safeHex(settings.backgroundColor)}
                onChange={(event) => patch({ backgroundColor: event.target.value })}
              />
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Margins</span>
            <div className={styles.marginGroup} role="group" aria-label="Page margins">
              {MARGIN_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.marginChip} ${settings.marginMm === value ? styles.marginChipActive : ""}`}
                  aria-pressed={settings.marginMm === value}
                  title={`${value} mm`}
                  onClick={() => patch({ marginMm: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.preview}>
          <div className={styles.previewHeader}>Preview</div>
          <div className={styles.previewStage}>
            <div
              className={styles.previewPage}
              style={{
                fontFamily: settings.fontFamily || undefined,
                fontSize: settings.fontSize || undefined,
                color: previewTextColor,
                backgroundColor: previewBgColor,
                padding: `${settings.marginMm}mm`,
              }}
            >
              <h1>The Mountain Keep</h1>
              <p>
                Mara pulled her hood tight and counted her steps — one for the heart, two for the
                hearth, three for the road that never ends.
              </p>
              <blockquote>A mountain is not climbed. It is kept, until it keeps you.</blockquote>
              <p>
                The keep stood where two ridgelines met, its stones older than the trees, older than
                the names carved into the gate.
              </p>
              <ul>
                <li>The first promise was kept at dawn.</li>
                <li>The second was kept at the river.</li>
                <li>The third is kept still — by whoever reads this page.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
