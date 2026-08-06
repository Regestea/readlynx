import { useMemo, useState } from "react";
import type { LexicalEditor } from "lexical";
import { Download, FileDown, LoaderCircle } from "lucide-react";
import {
  FONT_SIZE_OPTIONS,
  PAGE_FORMATS,
  PAGE_MARGIN_MM,
  PAGE_MARGIN_OPTIONS,
  TEXT_COLORS,
  uniformMargins,
} from "../components/ui/DocumentEditor/constants";
import type { PageFormat, PageMargins } from "../components/ui/DocumentEditor/constants";
import { CURATED_FONT_OPTIONS } from "../components/ui/DocumentEditor/utils/systemFonts";
import { buildPdfDocument } from "../export/PdfExporter";
import type { PdfExportOptions } from "../export/types";
import { Button } from "./ui/Button/Button";
import { Modal } from "./ui/Modal/Modal";
import { PdfPreview } from "./PdfPreview";
import styles from "./DocumentExporter.module.css";

export interface DocumentExporterProps {
  open: boolean;
  editor: LexicalEditor;
  defaultPageFormat?: PageFormat;
  defaultMargins?: PageMargins;
  onClose: () => void;
}
const PAPER_COLORS = {
  "#ffffff": "White",
  "#faf6ef": "Cream",
  "#eef3f9": "Ice",
  "#fdf6e3": "Sand",
  "#f9e2d7": "Apricot",
} as const satisfies Record<string, string>;

const FORMAT_OPTIONS: { value: PageFormat; label: string }[] = (Object.keys(PAGE_FORMATS) as PageFormat[]).map(
  (key) => ({ value: key, label: PAGE_FORMATS[key].label }),
);

const CHROMIUM_FONT_FAMILIES = [
  "Georgia, serif",
  "Inter, sans-serif",
  "Times New Roman, serif",
  "Courier New, monospace",
  "Vazirmatn, sans-serif",
  "Noto Sans Arabic, sans-serif",
];

export function DocumentExporter({
  open,
  editor,
  defaultPageFormat = "a4",
  defaultMargins,
  onClose,
}: DocumentExporterProps) {
  const [pageFormat, setPageFormat] = useState<PageFormat>(defaultPageFormat);
  const [margins, setMargins] = useState<PageMargins>(() => defaultMargins ?? uniformMargins(PAGE_MARGIN_MM));
  const [fontFamily, setFontFamily] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [textColor, setTextColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [chapterBreaks, setChapterBreaks] = useState(true);
  const [headerLeft, setHeaderLeft] = useState("");
  const [headerCenter, setHeaderCenter] = useState("");
  const [headerRight, setHeaderRight] = useState("");
  const [footerLeft, setFooterLeft] = useState("");
  const [footerCenter, setFooterCenter] = useState("");
  const [footerRight, setFooterRight] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const options: PdfExportOptions = useMemo(
    () => ({
      pageFormat,
      margins,
      fontFamily,
      fontSize,
      textColor,
      backgroundColor,
      showPageNumbers,
      chapterBreaks,
      headerLeft,
      headerCenter,
      headerRight,
      footerLeft,
      footerCenter,
      footerRight,
      inlineImages: true,
    }),
    [
      pageFormat,
      margins,
      fontFamily,
      fontSize,
      textColor,
      backgroundColor,
      showPageNumbers,
      chapterBreaks,
      headerLeft,
      headerCenter,
      headerRight,
      footerLeft,
      footerCenter,
      footerRight,
    ],
  );

  const curated = CURATED_FONT_OPTIONS.map((option) => option.value);
  const fontOptions = [
    { value: "", label: "Default" },
    ...CHROMIUM_FONT_FAMILIES.filter((family) => !curated.includes(family)).map((family) => ({
      value: family,
      label: family,
    })),
    ...CURATED_FONT_OPTIONS,
  ];

  const handleExport = async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const pdf = await buildPdfDocument(editor, options);
      const html = pdf.html;
      pdf.destroy();

      if (window.readlynx?.exportPdf) {
        const path = await window.readlynx.exportPdf({ defaultPath: "document.pdf", html });
        if (!path) {
          throw new Error("PDF export was cancelled.");
        }
      } else {
        printStandalone(html);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="PDF preview & export"
      wide
      footer={
        <>
          <span className={styles.meta}>
            <FileDown size={14} strokeWidth={1.8} aria-hidden="true" />
            {pageCount === null ? "Preparing pages…" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
          </span>
          {exportError && <span className={styles.errorText}>{exportError}</span>}
          <span className={styles.footerSpacer} />
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? (
              <LoaderCircle size={15} className={styles.spin} aria-hidden="true" />
            ) : (
              <Download size={15} strokeWidth={2} aria-hidden="true" />
            )}
            Export PDF
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.settings}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Page size</span>
            <select
              className={styles.control}
              value={pageFormat}
              title="Page size"
              aria-label="Page size"
              onChange={(event) => setPageFormat(event.target.value as PageFormat)}
            >
              {FORMAT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Margins</span>
            <div className={styles.chips} role="group" aria-label="Page margins">
              {PAGE_MARGIN_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.chip} ${margins.top === value && margins.bottom === value ? styles.chipActive : ""}`}
                  aria-pressed={margins.top === value}
                  onClick={() => setMargins(uniformMargins(value))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Typography</span>
            <div className={styles.row}>
              <select
                className={styles.control}
                value={fontFamily}
                title="Export font family"
                aria-label="Export font family"
                onChange={(event) => setFontFamily(event.target.value)}
              >
                {fontOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className={styles.control}
                value={fontSize}
                title="Export font size"
                aria-label="Export font size"
                onChange={(event) => setFontSize(event.target.value)}
              >
                <option value="">Default</option>
                {FONT_SIZE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.row}>
              <span className={styles.fieldLabel}>Text</span>
              <div className={styles.swatches} role="group" aria-label="Text colour">
                {TEXT_COLORS.map(({ value, label, swatch }) => (
                  <button
                    key={label}
                    type="button"
                    className={`${styles.swatch} ${textColor === value ? styles.swatchActive : ""}`}
                    style={{ backgroundColor: swatch }}
                    title={`Text colour ${label}`}
                    aria-label={`Text colour ${label}`}
                    onClick={() => setTextColor(value)}
                  />
                ))}
              </div>
            </div>

            <div className={styles.row}>
              <span className={styles.fieldLabel}>Paper</span>
              <div className={styles.chips} role="group" aria-label="Paper colour">
                {Object.entries(PAPER_COLORS).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`${styles.chip} ${backgroundColor === value ? styles.chipActive : ""}`}
                    aria-pressed={backgroundColor === value}
                    onClick={() => setBackgroundColor(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Running header</span>
            <div className={styles.row}>
              <input
                className={styles.control}
                value={headerLeft}
                placeholder="Left"
                aria-label="Header left"
                onChange={(event) => setHeaderLeft(event.target.value)}
              />
              <input
                className={styles.control}
                value={headerCenter}
                placeholder="Center"
                aria-label="Header center"
                onChange={(event) => setHeaderCenter(event.target.value)}
              />
              <input
                className={styles.control}
                value={headerRight}
                placeholder="Right"
                aria-label="Header right"
                onChange={(event) => setHeaderRight(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Running footer</span>
            <div className={styles.row}>
              <input
                className={styles.control}
                value={footerLeft}
                placeholder="Left"
                aria-label="Footer left"
                onChange={(event) => setFooterLeft(event.target.value)}
              />
              <input
                className={styles.control}
                value={footerCenter}
                placeholder="Center"
                aria-label="Footer center"
                onChange={(event) => setFooterCenter(event.target.value)}
              />
              <input
                className={styles.control}
                value={footerRight}
                placeholder="Right"
                aria-label="Footer right"
                onChange={(event) => setFooterRight(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Options</span>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={showPageNumbers}
                onChange={(event) => setShowPageNumbers(event.target.checked)}
              />
              <span>Page numbers</span>
            </label>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={chapterBreaks}
                onChange={(event) => setChapterBreaks(event.target.checked)}
              />
              <span>Start each H1 chapter on a new page</span>
            </label>
          </div>
        </div>

        <PdfPreview
          editor={editor}
          options={options}
          onPageCountChange={setPageCount}
          className={styles.preview}
        />
      </div>
    </Modal>
  );
}

/** Fallback when no Electron bridge is present: print the standby document. */
function printStandalone(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 8000);
  };
}