import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileDown, FileOutput, FileText, FileType2 } from "lucide-react";
import type { LexicalEditor } from "lexical";
import { TEXT_COLORS, PAGE_FORMATS } from "../constants";
import type { PageFormat } from "../constants";
import { PdfPreview } from "../../../../infrastructure/export/preview/PdfPreview";
import { EpubViewer } from "../../../../components/epubViewer/EpubViewer";
import type { PdfExportOptions } from "../../../../infrastructure/export/types";
import type { ExportThemeOptions } from "../types";
import {
  CODE_FONT_OPTIONS,
  EXPORT_CODE_THEME_OPTIONS,
  EXPORT_TEMPLATES,
} from "../../../../infrastructure/export/exportTheme";
import type { ExportCodeThemeId, ExportTemplateId } from "../../../../infrastructure/export/exportTheme";
import { exportHtml } from "../exporters/htmlExporter";
import { exportEpub, zipEpubFiles } from "../exporters/epubExporter";
import { Button } from "../../../../components/ui/Button/Button";
import { Modal } from "../../../../components/ui/Modal/Modal";
import styles from "./ExportDialog.module.css";

export type ExportFormat = "pdf" | "docx" | "html" | "epub";

export interface ExportSettings {
  format: ExportFormat;
  /** Global font-size scale in percent (0 = keep the sizes as authored). */
  fontSizeScalePct: number;
  textColor: string;
  backgroundColor: string;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  /** PDF-only: physical page size. */
  pageFormat: PageFormat;
  /** PDF-only: run a centred page number in the footer. */
  showPageNumbers: boolean;
  /** PDF-only: start every H1 on a new page. */
  chapterBreaks: boolean;
  /** PDF/EPUB-only: document look (none / modern light / modern dark). */
  template: ExportTemplateId;
  /** PDF/EPUB-only: code block highlight theme. */
  codeTheme: ExportCodeThemeId;
  /** PDF/EPUB-only: monospace font for code blocks ("" = default). */
  codeFontFamily: string;
}

const DEFAULT_SETTINGS: ExportSettings = {
  format: "pdf",
  fontSizeScalePct: 0,
  textColor: "",
  backgroundColor: "",
  marginTopMm: 12.7,
  marginRightMm: 12.7,
  marginBottomMm: 12.7,
  marginLeftMm: 12.7,
  pageFormat: "a4",
  showPageNumbers: true,
  chapterBreaks: true,
  template: "none",
  codeTheme: "auto",
  codeFontFamily: "",
};

const FORMATS: { value: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { value: "pdf", label: "PDF", icon: <FileDown size={14} strokeWidth={1.8} aria-hidden="true" /> },
  { value: "docx", label: "DOCX", icon: <FileOutput size={14} strokeWidth={1.8} aria-hidden="true" /> },
  { value: "html", label: "HTML", icon: <FileText size={14} strokeWidth={1.8} aria-hidden="true" /> },
  { value: "epub", label: "EPUB", icon: <FileType2 size={14} strokeWidth={1.8} aria-hidden="true" /> },
];

interface TemplateChip {
  id: ExportTemplateId;
  name: string;
  desc: string;
  textColor: string;
  backgroundColor: string;
  /** Uniform page margin in millimeters applied to every side. */
  marginMm: number;
}

/** "None" keeps the plain look: no colours forced, default margins. */
const TEMPLATES: TemplateChip[] = [
  {
    id: "none",
    name: "None",
    desc: "Plain look",
    textColor: "",
    backgroundColor: "",
    marginMm: 0,
  },
  ...EXPORT_TEMPLATES.map(({ id, name, desc, textColor, backgroundColor, marginMm }) => ({
    id,
    name,
    desc,
    textColor,
    backgroundColor,
    marginMm,
  })),
];

const PAPER_COLORS = [
  { value: "#ffffff", label: "White", swatch: "#ffffff" },
  { value: "#faf6ef", label: "Cream", swatch: "#faf6ef" },
  { value: "#f4f4f0", label: "Stone", swatch: "#f4f4f0" },
  { value: "#eef3f9", label: "Ice", swatch: "#eef3f9" },
  { value: "#fdf6e3", label: "Sand", swatch: "#fdf6e3" },
  { value: "#e9f1ec", label: "Mint", swatch: "#e9f1ec" },
];

const PAGE_FORMAT_OPTIONS: { value: PageFormat; label: string }[] = (
  Object.keys(PAGE_FORMATS) as PageFormat[]
).map((key) => ({ value: key, label: PAGE_FORMATS[key].label }));

const MARGIN_SIDES: { key: "marginTopMm" | "marginRightMm" | "marginBottomMm" | "marginLeftMm"; label: string }[] = [
  { key: "marginTopMm", label: "Top" },
  { key: "marginRightMm", label: "Right" },
  { key: "marginBottomMm", label: "Bottom" },
  { key: "marginLeftMm", label: "Left" },
];

const INCH_MIN = 0;
const INCH_MAX = 2.4;
const MM_PER_INCH = 25.4;
const toInches = (mm: number): number => Math.round((mm / MM_PER_INCH) * 100) / 100;
const toMm = (inch: number): number => Math.round(inch * MM_PER_INCH * 100) / 100;
const clampInches = (value: number): number =>
  Math.min(INCH_MAX, Math.max(INCH_MIN, Number.isFinite(value) ? value : INCH_MIN));

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
    marginTopMm: defaultMarginMm ?? DEFAULT_SETTINGS.marginTopMm,
    marginRightMm: defaultMarginMm ?? DEFAULT_SETTINGS.marginRightMm,
    marginBottomMm: defaultMarginMm ?? DEFAULT_SETTINGS.marginBottomMm,
    marginLeftMm: defaultMarginMm ?? DEFAULT_SETTINGS.marginLeftMm,
    pageFormat: defaultPageFormat ?? DEFAULT_SETTINGS.pageFormat,
  }));
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const paperColorInputRef = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [resolvedCover, setResolvedCover] = useState<string | undefined>(undefined);
  const [epubSrc, setEpubSrc] = useState<ArrayBuffer | null>(null);

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

  const themeOptions: ExportThemeOptions = useMemo(
    () => ({
      textColor: settings.textColor,
      backgroundColor: settings.backgroundColor,
      fontSizeScalePct: settings.fontSizeScalePct,
      margins: {
        top: settings.marginTopMm,
        right: settings.marginRightMm,
        bottom: settings.marginBottomMm,
        left: settings.marginLeftMm,
      },
      template: settings.template,
      codeTheme: settings.codeTheme,
      codeFontFamily: settings.codeFontFamily,
    }),
    [
      settings.textColor,
      settings.backgroundColor,
      settings.fontSizeScalePct,
      settings.marginTopMm,
      settings.marginRightMm,
      settings.marginBottomMm,
      settings.marginLeftMm,
      settings.template,
      settings.codeTheme,
      settings.codeFontFamily,
    ],
  );

  const patch = (partial: Partial<ExportSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    if (partial.format && partial.format !== settings.format) {
      setPageCount(null);
      setEpubSrc(null);
    }
  };

  useEffect(() => {
    if (!open || settings.format !== "epub") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const files = exportEpub(editor, {}, themeOptions, resolvedCover);
        void zipEpubFiles(files)
          .arrayBuffer()
          .then((buffer) => {
            if (!cancelled) setEpubSrc(buffer);
          })
          .catch(() => {
            if (!cancelled) setEpubSrc(null);
          });
      } catch {
        if (!cancelled) setEpubSrc(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, settings.format, editor, themeOptions, resolvedCover]);

  const htmlSrc = useMemo(
    () =>
      settings.format === "docx" || settings.format === "html"
        ? exportHtml(editor, themeOptions, resolvedCover)
        : "",
    [editor, themeOptions, resolvedCover, settings.format],
  );

  const previewOptions: PdfExportOptions = useMemo(
    () => ({
      pageFormat: settings.pageFormat,
      margins: {
        top: settings.marginTopMm,
        right: settings.marginRightMm,
        bottom: settings.marginBottomMm,
        left: settings.marginLeftMm,
      },
      textColor: settings.textColor,
      backgroundColor: settings.backgroundColor,
      fontSizeScalePct: settings.fontSizeScalePct,
      showPageNumbers: settings.showPageNumbers,
      chapterBreaks: settings.chapterBreaks,
      inlineImages: true,
      coverImage: resolvedCover,
      template: settings.template,
      codeTheme: settings.codeTheme,
      codeFontFamily: settings.codeFontFamily,
    }),
    [settings, resolvedCover],
  );

  const applyTemplate = (template: TemplateChip) => {
    const marginMm =
      template.marginMm || defaultMarginMm || DEFAULT_SETTINGS.marginTopMm;
    setSettings((prev) => ({
      ...prev,
      template: template.id,
      textColor: template.textColor,
      backgroundColor: template.backgroundColor,
      marginTopMm: marginMm,
      marginRightMm: marginMm,
      marginBottomMm: marginMm,
      marginLeftMm: marginMm,
    }));
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
          {settings.format !== "docx" && settings.format !== "html" && (
            <span className={styles.meta}>
              <FileDown size={14} strokeWidth={1.8} aria-hidden="true" />
              {pageCount === null ? "Preparing preview…" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
            </span>
          )}
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

          {(settings.format === "pdf" || settings.format === "epub") && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Template</span>
              <div className={styles.templates}>
                {TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`${styles.template} ${settings.template === template.id ? styles.templateActive : ""}`}
                    onClick={() => applyTemplate(template)}
                  >
                    <span className={styles.templateName}>
                      {settings.template === template.id && (
                        <Check size={13} className={styles.templateCheck} aria-hidden="true" />
                      )}
                      {template.name}
                    </span>
                    <span className={styles.templateDesc}>{template.desc}</span>
                  </button>
                ))}
              </div>
              <p className={styles.sectionHint}>
                Dark and light templates style the whole document — headings, quotes, tables and
                callouts — with colours tuned for easy reading.
              </p>
            </div>
          )}

          {(settings.format === "pdf" || settings.format === "epub") && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Code blocks</span>
              <label className={styles.codeField}>
                <span className={styles.codeFieldLabel}>Highlight theme</span>
                <select
                  className={styles.control}
                  value={settings.codeTheme}
                  title="Code block highlight theme"
                  aria-label="Code block highlight theme"
                  onChange={(event) =>
                    patch({ codeTheme: event.target.value as ExportCodeThemeId })
                  }
                >
                  {EXPORT_CODE_THEME_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.codeField}>
                <span className={styles.codeFieldLabel}>Font</span>
                <select
                  className={styles.control}
                  value={settings.codeFontFamily}
                  title="Code block font"
                  aria-label="Code block font"
                  onChange={(event) => patch({ codeFontFamily: event.target.value })}
                >
                  {CODE_FONT_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Font size</span>
            <div className={styles.row}>
              <input
                type="number"
                className={styles.control}
                min={0}
                max={200}
                step={5}
                value={settings.fontSizeScalePct}
                title="Font size scale (percent)"
                aria-label="Font size scale (percent)"
                onChange={(event) =>
                  patch({
                    fontSizeScalePct: Math.max(0, Math.min(200, Number(event.target.value) || 0)),
                  })
                }
              />
              <span className={styles.percentSuffix}>%</span>
            </div>
            <p className={styles.sectionHint}>
              0% keeps your heading and paragraph sizes as authored (e.g. 18px headings, 14px
              paragraphs). 10% increases every size by 10%.
            </p>
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

          {settings.format !== "epub" && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Margins (in)</span>
              <div className={styles.marginGrid}>
                {MARGIN_SIDES.map(({ key, label }) => (
                  <label key={key} className={styles.marginField}>
                    <span className={styles.marginFieldLabel}>{label}</span>
                    <input
                      type="number"
                      className={styles.control}
                      min={INCH_MIN}
                      max={INCH_MAX}
                      step={0.1}
                      value={toInches(settings[key])}
                      title={`${label} margin in inches`}
                      aria-label={`${label} margin`}
                      onChange={(event) =>
                        patch({
                          [key]: toMm(clampInches(Number(event.target.value))),
                        } as Partial<ExportSettings>)
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

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
          {settings.format === "pdf" && (
            <PdfPreview
              editor={editor}
              options={previewOptions}
              onPageCountChange={setPageCount}
              className={styles.previewBody}
            />
          )}
          {settings.format === "epub" &&
            (epubSrc ? (
              <EpubViewer
                srcData={epubSrc}
                toolbar={false}
                showNav
                fill
                backgroundColorOverride={settings.backgroundColor || "#ffffff"}
                textColorOverride={settings.textColor || "#111111"}
                className={`${styles.previewBody} ${styles.epubPreview}`}
                onPageCountChange={setPageCount}
              />
            ) : (
              <div className={styles.previewPlaceholder}>Building EPUB preview…</div>
            ))}
          {(settings.format === "docx" || settings.format === "html") && (
            <iframe
              srcDoc={htmlSrc}
              className={styles.htmlPreview}
              title="Document preview"
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
