import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileDown, FileOutput, FileText, FileType2 } from "lucide-react";
import type { LexicalEditor } from "lexical";
import { CURATED_FONT_OPTIONS, getInstalledFonts } from "../utils/systemFonts";
import { FONT_SIZE_OPTIONS, TEXT_COLORS, PAGE_FORMATS, uniformMargins } from "../constants";
import type { PageFormat } from "../constants";
import { PdfPreview } from "../../../PdfPreview";
import type { PdfExportOptions } from "../../../../export/types";
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
  /** PDF-only: physical page size. */
  pageFormat: PageFormat;
  /** PDF-only: run a centred page number in the footer. */
  showPageNumbers: boolean;
  /** PDF-only: start every H1 on a new page. */
  chapterBreaks: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
}

const DEFAULT_SETTINGS: ExportSettings = {
  format: "pdf",
  fontFamily: "",
  fontSize: "",
  textColor: "",
  backgroundColor: "",
  marginMm: 12.7,
  pageFormat: "a4",
  showPageNumbers: true,
  chapterBreaks: true,
  headerLeft: "",
  headerCenter: "",
  headerRight: "",
  footerLeft: "",
  footerCenter: "",
  footerRight: "",
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

const PAGE_FORMAT_OPTIONS: { value: PageFormat; label: string }[] = (
  Object.keys(PAGE_FORMATS) as PageFormat[]
).map((key) => ({ value: key, label: PAGE_FORMATS[key].label }));

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  editor: LexicalEditor;
  onExport: (settings: ExportSettings) => void;
  defaultMarginMm?: number;
  defaultPageFormat?: PageFormat;
  coverImage?: string;
}

export function ExportDialog({
  open,
  onClose,
  editor,
  onExport,
  defaultMarginMm,
  defaultPageFormat,
  coverImage,
}: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>(() => ({
    ...DEFAULT_SETTINGS,
    marginMm: defaultMarginMm ?? DEFAULT_SETTINGS.marginMm,
    pageFormat: defaultPageFormat ?? DEFAULT_SETTINGS.pageFormat,
  }));
  const [installed, setInstalled] = useState<string[]>([]);
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const paperColorInputRef = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [resolvedCover, setResolvedCover] = useState<string | undefined>(undefined);

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
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!coverImage) {
        setResolvedCover(undefined);
        return;
      }
      if (coverImage.startsWith("data:")) {
        setResolvedCover(coverImage);
        return;
      }
      const relativePath = coverImage.startsWith("readlynx-cover://")
        ? decodeURIComponent(new URL(coverImage).pathname.replace(/^\/+/, ""))
        : coverImage;
      const data = await window.readlynx?.readCoverDataUrl(relativePath);
      if (!cancelled) setResolvedCover(data ?? undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [coverImage]);

  const previewOptions: PdfExportOptions = useMemo(
    () => ({
      pageFormat: settings.pageFormat,
      margins: uniformMargins(settings.marginMm),
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      textColor: settings.textColor,
      backgroundColor: settings.backgroundColor,
      showPageNumbers: settings.showPageNumbers,
      chapterBreaks: settings.chapterBreaks,
      headerLeft: settings.headerLeft,
      headerCenter: settings.headerCenter,
      headerRight: settings.headerRight,
      footerLeft: settings.footerLeft,
      footerCenter: settings.footerCenter,
      footerRight: settings.footerRight,
      inlineImages: true,
      coverImage: resolvedCover,
    }),
    [settings, resolvedCover],
  );

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export document"
      wide
      footer={
        <>
          <span className={styles.meta}>
            <FileDown size={14} strokeWidth={1.8} aria-hidden="true" />
            {pageCount === null ? "Paginating…" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
          </span>
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

          {settings.format === "pdf" && (
            <>
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Page size</span>
                <select
                  className={styles.control}
                  value={settings.pageFormat}
                  title="Page size"
                  aria-label="Page size"
                  onChange={(event) => patch({ pageFormat: event.target.value as PageFormat })}
                >
                  {PAGE_FORMAT_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Running header</span>
                <div className={styles.row}>
                  {(
                    [
                      ["headerLeft", "Left"],
                      ["headerCenter", "Center"],
                      ["headerRight", "Right"],
                    ] as const
                  ).map(([key, placeholder]) => (
                    <input
                      key={key}
                      className={styles.control}
                      value={settings[key]}
                      placeholder={placeholder}
                      aria-label={`Header ${placeholder}`}
                      onChange={(event) => patch({ [key]: event.target.value } as Partial<ExportSettings>)}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Running footer</span>
                <div className={styles.row}>
                  {(
                    [
                      ["footerLeft", "Left"],
                      ["footerCenter", "Center"],
                      ["footerRight", "Right"],
                    ] as const
                  ).map(([key, placeholder]) => (
                    <input
                      key={key}
                      className={styles.control}
                      value={settings[key]}
                      placeholder={placeholder}
                      aria-label={`Footer ${placeholder}`}
                      onChange={(event) => patch({ [key]: event.target.value } as Partial<ExportSettings>)}
                    />
                  ))}
                </div>
                <p className={styles.sectionHint}>
                  Tip: write <code>counter(page)</code> to print the page number.
                </p>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Options</span>
                <label className={styles.toggleRow}>
                  <input
                    type="checkbox"
                    checked={settings.showPageNumbers}
                    onChange={(event) => patch({ showPageNumbers: event.target.checked })}
                  />
                  <span>Page numbers</span>
                </label>
                <label className={styles.toggleRow}>
                  <input
                    type="checkbox"
                    checked={settings.chapterBreaks}
                    onChange={(event) => patch({ chapterBreaks: event.target.checked })}
                  />
                  <span>Start each H1 chapter on a new page</span>
                </label>
              </div>
            </>
          )}
        </div>

        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            Preview
            {pageCount !== null && <span className={styles.previewCount}>· {pageCount} page{pageCount === 1 ? "" : "s"}</span>}
          </div>
          <PdfPreview
            editor={editor}
            options={previewOptions}
            onPageCountChange={setPageCount}
            className={styles.previewBody}
          />
        </div>
      </div>
    </Modal>
  );
}
