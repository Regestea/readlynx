import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileDown } from "lucide-react";
import { EpubViewer } from "../epubViewer/EpubViewer";
import { buildHtmlDocument } from "../../infrastructure/export/htmlDocument";
import { countChapterBreaks, countChapterHeadings } from "../../infrastructure/export/chapterBreaks";
import type { PdfExportOptions } from "../../infrastructure/export/types";
import {
  CODE_FONT_OPTIONS,
  EXPORT_CODE_THEME_OPTIONS,
} from "../../infrastructure/export/exportTheme";
import type { ExportCodeThemeId } from "../../infrastructure/export/exportTheme";
import { Button } from "../ui/Button/Button";
import { FontFamilySelect } from "../FontFamilySelect/FontFamilySelect";
import { Modal } from "../ui/Modal/Modal";
import {
  MAX_FONT_SCALE_PCT,
  MIN_FONT_SCALE_PCT,
} from "../../infrastructure/export/fontScale";
import { clampInches, INCH_MAX, INCH_MIN, toInches, toMm } from "./marginUnits";
import { DEFAULT_EXPORT_SETTINGS, EXPORT_FORMAT_OPTIONS, usesPagedLook } from "./types.tsx";
import type { ExportContent, ExportSettings } from "./types.tsx";
import {
  CHAPTER_LEVEL_OPTIONS,
  CHAPTER_MIN_LINES_OPTIONS,
  MARGIN_SIDES,
  PAGE_FORMAT_OPTIONS,
  PAPER_COLORS,
  TEMPLATE_CHIPS,
  TEXT_COLORS,
  initialExportSettings,
  isCustomColor,
  safeHex,
} from "./presets";
import { PdfPreview } from "./PdfPreview";
import styles from "./ExportDialog.module.css";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** What is being exported. Supplies the body HTML (and, when supported, the
   *  EPUB archive for the preview) plus the formats this source can produce —
   *  the dialog itself knows nothing about where the content comes from. */
  content: ExportContent;
  /** Called with the chosen settings; the host performs the actual export. */
  onExport: (settings: ExportSettings) => void;
  defaultMarginMm?: number;
  defaultPageFormat?: ExportSettings["pageFormat"];
  coverImage?: string;
  /** Stacks above a dialog that is already open. */
  raised?: boolean;
}

/**
 * The export dialog: pick a format, tune the look, preview the result, and
 * hand the settings back to the host to write the file.
 *
 * Source-agnostic by design. It only ever asks its `ExportContent` for
 * semantic HTML (and an EPUB archive for that tab's preview), so the document
 * editor and the reading view's translated books share one dialog, one set of
 * options and one preview implementation.
 */
function toggleChapterLevel(levels: readonly number[], level: number, on: boolean): number[] {
  const next = on ? [...new Set([...levels, level])] : levels.filter((value) => value !== level);
  return next.sort((a, b) => a - b);
}

export function ExportDialog({
  open,
  onClose,
  content,
  onExport,
  defaultMarginMm,
  defaultPageFormat,
  coverImage,
  raised = false,
}: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>(() =>
    initialExportSettings(DEFAULT_EXPORT_SETTINGS, { defaultMarginMm, defaultPageFormat }),
  );
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const paperColorInputRef = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [resolvedCover, setResolvedCover] = useState<string | undefined>(undefined);
  const [epubSrc, setEpubSrc] = useState<ArrayBuffer | null>(null);

  /** Formats the source can really produce; anything else is not offered, so
   *  a host never shows a tab it cannot honour. */
  const formats = useMemo(
    () => EXPORT_FORMAT_OPTIONS.filter((option) => content.formats.includes(option.value)),
    [content.formats],
  );

  /** Falls back to the first supported format if the current one is gone
   *  (e.g. the source stopped supporting EPUB). */
  if (open && !content.formats.includes(settings.format) && formats.length > 0) {
    setSettings((current) => ({ ...current, format: formats[0].value }));
  }

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

  const themeOptions = useMemo(
    () => ({
      textColor: settings.textColor,
      backgroundColor: settings.backgroundColor,
      fontSizeScalePct: settings.fontSizeScalePct,
      fontFamily: settings.fontFamily,
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
      settings.fontFamily,
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

  /** The body as the source produces it. Chapter breaks are stamped by the
   *  pagination pass, not here, so switching the levels re-paginates instead of
   *  re-parsing every chapter. */
  const sourceBodyHtml = useMemo(() => content.bodyHtml(), [content]);

  // Counted by the same routine that does the marking, so the number shown can
  // never disagree with the number of breaks actually inserted. A break only
  // appears from the *second* heading of a level onwards, so a level with one
  // heading — or none — is a tick that silently does nothing.
  const headingCountsByLevel = useMemo(
    () => countChapterHeadings(sourceBodyHtml),
    [sourceBodyHtml],
  );
  const totalChapterBreaks = useMemo(
    () => countChapterBreaks(sourceBodyHtml, settings.chapterLevels),
    [sourceBodyHtml, settings.chapterLevels],
  );
  const chapterLevelsAreInert =
    settings.chapterLevels.length > 0 &&
    settings.chapterLevels.every((level) => (headingCountsByLevel[level] ?? 0) <= 1);
  const [chapterBreaksDropped, setChapterBreaksDropped] = useState(0);
  const reportDroppedBreaks = useCallback((count: number) => {
    setChapterBreaksDropped((previous) => (previous === count ? previous : count));
  }, []);

  useEffect(() => {
    if (!open || settings.format !== "epub" || !content.epub) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const buffer = (await content.epub?.(themeOptions, resolvedCover)) ?? null;
          if (!cancelled) setEpubSrc(buffer);
        } catch {
          if (!cancelled) setEpubSrc(null);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, settings.format, content, themeOptions, resolvedCover]);

  const htmlSrc = useMemo(
    () =>
      settings.format === "docx" || settings.format === "html"
        ? buildHtmlDocument(
            content.bodyHtml(),
            themeOptions,
            resolvedCover,
            content.label,
          )
        : "",
    [content, themeOptions, resolvedCover, settings.format],
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
      fontFamily: settings.fontFamily,
      showPageNumbers: settings.showPageNumbers,
      chapterLevels: settings.chapterLevels,
      inlineImages: true,
      coverImage: resolvedCover,
      template: settings.template,
      codeTheme: settings.codeTheme,
      codeFontFamily: settings.codeFontFamily,
    }),
    [settings, resolvedCover],
  );

  const applyTemplate = (template: (typeof TEMPLATE_CHIPS)[number]) => {
    const marginMm =
      template.marginMm || defaultMarginMm || DEFAULT_EXPORT_SETTINGS.marginTopMm;
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

  const formatLabel = formats.find((format) => format.value === settings.format)?.label ?? "PDF";
  const pagedLook = usesPagedLook(settings.format);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Export ${content.label.toLowerCase()}`}
      wide
      raised={raised}
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
              {formats.map(({ value, label, icon }) => (
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

          {pagedLook && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Template</span>
              <div className={styles.templates}>
                {TEMPLATE_CHIPS.map((template) => (
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

          {pagedLook && (
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
            <span className={styles.sectionLabel}>Font</span>
            <div className={styles.row}>
              <FontFamilySelect
                value={settings.fontFamily}
                onSelect={(fontFamily) => patch({ fontFamily })}
                defaultLabel="Book font"
                className={styles.fontSelect}
              />
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Font size</span>
            <div className={styles.row}>
              <input
                type="number"
                className={styles.control}
                min={MIN_FONT_SCALE_PCT}
                max={MAX_FONT_SCALE_PCT}
                step={5}
                value={settings.fontSizeScalePct}
                title="Font size scale (percent)"
                aria-label="Font size scale (percent)"
                onChange={(event) =>
                  patch({
                    fontSizeScalePct: Math.min(
                      MAX_FONT_SCALE_PCT,
                      Math.max(
                        MIN_FONT_SCALE_PCT,
                        Number(event.target.value) || 0,
                      ),
                    ),
                  })
                }
              />
              <span className={styles.percentSuffix}>%</span>
            </div>
            <p className={styles.sectionHint}>
              0% keeps your heading and paragraph sizes as authored (e.g. 18px headings, 14px
              paragraphs). 10% increases every size by 10%; negative values shrink them, so -20%
              makes everything 20% smaller.
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
                  onChange={(event) =>
                    patch({ pageFormat: event.target.value as ExportSettings["pageFormat"] })
                  }
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
                <fieldset className={styles.checkboxGroup}>
                  <legend className={styles.codeFieldLabel}>
                    Start each chapter on a new page
                  </legend>
                  <div className={styles.checkboxRow}>
                    {CHAPTER_LEVEL_OPTIONS.map((option) => {
                      const total = headingCountsByLevel[option.value] ?? 0;
                      const canBreak = total > 1;
                      return (
                        <label
                          key={option.value}
                          className={styles.checkboxOption}
                          title={
                            canBreak
                              ? `${total} ${option.label.replace("Each ", "").toLowerCase()} in this document`
                              : total === 0
                                ? "This document has no headings at this level"
                                : "Only one heading at this level, so there is nowhere to break"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={settings.chapterLevels.includes(option.value)}
                            onChange={(event) =>
                              patch({
                                chapterLevels: toggleChapterLevel(
                                  settings.chapterLevels,
                                  option.value,
                                  event.target.checked,
                                ),
                              })
                            }
                          />
                          <span>{option.label}</span>
                          <span className={canBreak ? styles.levelCount : styles.levelCountMuted}>
                            {total}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <span className={styles.sectionHint}>
                    The number after each level is how many headings the document has. A break is
                    inserted before every heading after the first one of that level, so a level with
                    one heading can never break.
                  </span>
                  {chapterLevelsAreInert ? (
                    <span className={styles.checkboxWarning}>
                      None of the ticked levels has more than one heading, so no page break will be
                      inserted.
                    </span>
                  ) : null}
                  <label className={styles.codeField}>
                    <span className={styles.codeFieldLabel}>Avoid empty pages</span>
                    <select
                      className={styles.control}
                      value={String(settings.chapterMinLines)}
                      title="Drop a chapter break when the page it opens would be nearly empty"
                      aria-label="Minimum lines for a page to keep its chapter break"
                      onChange={(event) =>
                        patch({ chapterMinLines: Number(event.target.value) || 0 })
                      }
                    >
                      {CHAPTER_MIN_LINES_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <span className={styles.sectionHint}>
                      A heading that opens a page holding only a line or two makes for a very empty
                      page. This drops that break and lets the text flow on, measured on the real
                      page so it follows the page size and font size.
                    </span>
                  </label>
                  {chapterBreaksDropped > 0 ? (
                    <span className={styles.checkboxNote}>
                      {chapterBreaksDropped} of {totalChapterBreaks} chapter break
                      {chapterBreaksDropped === 1 ? "" : "s"} dropped because the page would have
                      been nearly empty.
                    </span>
                  ) : null}
                </fieldset>
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
              bodyHtml={sourceBodyHtml}
              options={previewOptions}
              onPageCountChange={setPageCount}
              onChapterBreaksDropped={reportDroppedBreaks}
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
