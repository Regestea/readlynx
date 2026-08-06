import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Code,
  FileDown,
  FileText,
  FolderOpen,
  List,
  ListChecks,
  ListOrdered,
  Maximize,
  Minimize,
  FilePlus,
  Palette,
  Quote,
  Save,
} from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $setTextFormat,
  FORMAT_ELEMENT_COMMAND,
} from "lexical";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useDefaultFont, useEditorAPI, useToolbarState } from "../context";
import { HistoryButtons } from "./HistoryButtons";
import { TextFormatButtons } from "./TextFormatButtons";
import { InsertButtons } from "./InsertButtons";
import { insertImage } from "../plugins/ImagePlugin";
import { insertTable } from "../plugins/TablePlugin";
import { $createPageBreakNode } from "../nodes/PageBreakNode";
import { ImageEditorDialog } from "../../ImageEditorDialog/ImageEditorDialog";
import { FontFamilySelect } from "./FontFamilySelect";
import { ExportDialog, type ExportSettings } from "./ExportDialog";
import { MarginDialog } from "./MarginDialog";
import { DEFAULT_FONT_SIZE_VALUE, FONT_SIZE_OPTIONS, HEADING_OPTIONS, TEXT_COLORS, BACKGROUND_COLORS, PAGE_MARGIN_OPTIONS, PAGE_MARGIN_MM, uniformMargins } from "../constants";
import type { PageFormat, PageMargins } from "../constants";
import type { BlockType, ExportThemeOptions } from "../types";
import { exportDocx } from "../exporters/docxExporter";
import { exportEpub, zipEpubFiles } from "../exporters/epubExporter";
import { exportHtml } from "../exporters/htmlExporter";
import { buildPdfDocument } from "../../../../export/PdfExporter";
import { Modal } from "../../Modal/Modal";
import { Button } from "../../Button/Button";
import { Input } from "../../Input/Input";
import styles from "../DocumentEditor.module.css";

interface ToolbarProps {
  fullscreen: boolean;
  onToggleFullscreen: (editorState: string) => void;
  paged?: boolean;
  pageFormat?: PageFormat;
  margins?: PageMargins;
  onMarginsChange?: (margins: PageMargins) => void;
  onSave?: () => void | Promise<void>;
  coverImage?: string;
}

interface PromptDialogState {
  kind: "link" | "table";
  url: string;
  alt: string;
  rows?: number;
  columns?: number;
}

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Temporarily hides everything outside `rootEl` so print/PDF only contains the editor. */
function isolateForPrint(rootEl: HTMLElement | null): () => void {
  if (!rootEl) return () => undefined;
  const hidden: { el: HTMLElement; prev: string }[] = [];
  let el: HTMLElement | null = rootEl;
  while (el && el !== document.body) {
    const parent: HTMLElement | null = el.parentElement;
    if (parent) {
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== el && sibling instanceof HTMLElement) {
          hidden.push({ el: sibling, prev: sibling.style.display });
          sibling.style.display = "none";
        }
      }
    }
    el = parent;
  }
  return () => {
    for (const { el: element, prev } of hidden) element.style.display = prev;
  };
}

/* ---------- Menu primitives ---------- */

function Menu({
  label,
  icon,
  align = "left",
  children,
}: {
  label: string;
  icon?: ReactNode;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={styles.menu} ref={ref}>
      <button
        type="button"
        className={styles.menuButton}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div
          className={[
            styles.menuPanel,
            align === "right" ? styles.menuPanelRight : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  onSelect,
  close,
  checked,
}: {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  onSelect?: () => void;
  close?: () => void;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.menuItem}
      onClick={() => {
        onSelect?.();
        close?.();
      }}
    >
      <span className={styles.menuItemIcon}>{icon ?? (checked ? <Check size={13} /> : null)}</span>
      <span className={styles.menuItemLabel}>{label}</span>
      {shortcut && <span className={styles.menuItemShortcut}>{shortcut}</span>}
    </button>
  );
}

/* ---------- Toolbar ---------- */

const LINE_TYPE_OPTIONS: { value: BlockType; label: string; icon: ReactNode }[] = [
  { value: "quote", label: "Quote", icon: <Quote size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "code", label: "Code block", icon: <Code size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "ul", label: "Bullet list", icon: <List size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "ol", label: "Numbered list", icon: <ListOrdered size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "check", label: "Checklist", icon: <ListChecks size={15} strokeWidth={2} aria-hidden="true" /> },
];

const ALIGN_OPTIONS: { value: "left" | "center" | "right" | "justify"; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Align left", icon: <AlignLeft size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "center", label: "Align center", icon: <AlignCenter size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "right", label: "Align right", icon: <AlignRight size={15} strokeWidth={2} aria-hidden="true" /> },
  { value: "justify", label: "Align justify", icon: <AlignJustify size={15} strokeWidth={2} aria-hidden="true" /> },
];

export function Toolbar({
  fullscreen,
  onToggleFullscreen,
  paged = false,
  pageFormat = "a4",
  margins,
  onMarginsChange,
  onSave,
  coverImage,
}: ToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const api = useEditorAPI();
  const state = useToolbarState();
  const { defaultFontFamily } = useDefaultFont();
  const importInputRef = useRef<HTMLInputElement>(null);
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const [promptDialog, setPromptDialog] = useState<PromptDialogState | null>(null);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [imageEditorKey, setImageEditorKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSession, setExportSession] = useState(0);
  const [marginDialogOpen, setMarginDialogOpen] = useState(false);
  const [marginDialogSession, setMarginDialogSession] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) window.clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      await onSave();
      setShowSaved(true);
      if (savedTimeoutRef.current) window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setShowSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const pageMargins = margins ?? uniformMargins(PAGE_MARGIN_MM);
  const presetMargin = PAGE_MARGIN_OPTIONS.find(
    (option) =>
      pageMargins.top === option.value &&
      pageMargins.right === option.value &&
      pageMargins.bottom === option.value &&
      pageMargins.left === option.value,
  )?.value;

  const handleToggleFullscreen = useCallback(() => {
    onToggleFullscreen(api.saveState());
  }, [api, onToggleFullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleToggleFullscreen();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen, handleToggleFullscreen]);

  const onImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      api.importMarkdown(text);
    };
    reader.readAsText(file);
  };

  const onExportMarkdown = () => {
    downloadFile("document.md", api.exportMarkdown(), "text/markdown;charset=utf-8");
  };

  const onExportPdf = async (settings: ExportSettings, resolvedCover?: string) => {
    if (window.readlynx?.exportPdf) {
      const { html } = await buildPdfDocument(editor, {
        pageFormat: settings.pageFormat,
        margins: {
          top: settings.marginTopMm,
          right: settings.marginRightMm,
          bottom: settings.marginBottomMm,
          left: settings.marginLeftMm,
        },
        fontFamily: defaultFontFamily,
        fontSizeScalePct: settings.fontSizeScalePct,
        textColor: settings.textColor,
        backgroundColor: settings.backgroundColor,
        showPageNumbers: settings.showPageNumbers,
        chapterBreaks: settings.chapterBreaks,
        inlineImages: true,
        coverImage: resolvedCover,
      });
      await window.readlynx.exportPdf({
        defaultPath: "document.pdf",
        html,
      });
      return;
    }
    const rootEl = editor.getRootElement()?.closest<HTMLElement>(`.${styles.root}`) ?? null;
    const restore = isolateForPrint(rootEl);
    try {
      window.print();
    } finally {
      restore();
    }
  };

  const themeFor = (settings: ExportSettings): ExportThemeOptions => ({
    fontSizeScalePct: settings.fontSizeScalePct,
    textColor: settings.textColor,
    backgroundColor: settings.backgroundColor,
    margins: {
      top: settings.marginTopMm,
      right: settings.marginRightMm,
      bottom: settings.marginBottomMm,
      left: settings.marginLeftMm,
    },
  });

  const onExportDocx = async (settings: ExportSettings, resolvedCover?: string) => {
    downloadBlob("document.docx", await exportDocx(editor, pageFormat, themeFor(settings), resolvedCover));
  };

  const onExportHtml = (settings: ExportSettings, resolvedCover?: string) => {
    downloadFile("document.html", exportHtml(editor, themeFor(settings), resolvedCover), "text/html;charset=utf-8");
  };

  const onExportEpub = (settings: ExportSettings, resolvedCover?: string) => {
    const files = exportEpub(editor, { title: "My Book", author: "ReadLynx" }, themeFor(settings), resolvedCover);
    downloadBlob("document.epub", zipEpubFiles(files));
  };

  const resolveCoverDataUrl = async (image: string | undefined): Promise<string | undefined> => {
    if (!image) return undefined;
    if (image.startsWith("data:")) return image;
    if (window.readlynx?.readCoverDataUrl) {
      const relativePath = image.startsWith("readlynx-cover://")
        ? decodeURIComponent(new URL(image).pathname.replace(/^\/+/, ""))
        : image;
      const dataUrl = await window.readlynx.readCoverDataUrl(relativePath);
      if (dataUrl) return dataUrl;
    }
    return undefined;
  };

  const runExport = async (settings: ExportSettings) => {
    const resolvedCover = await resolveCoverDataUrl(coverImage);
    switch (settings.format) {
      case "pdf":
        void onExportPdf(settings, resolvedCover);
        break;
      case "docx":
        void onExportDocx(settings, resolvedCover);
        break;
      case "html":
        onExportHtml(settings, resolvedCover);
        break;
      case "epub":
        onExportEpub(settings, resolvedCover);
        break;
    }
    setExportOpen(false);
  };

  const onToggleLink = () => {
    if (state.isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    setPromptDialog({ kind: "link", url: "https://", alt: "" });
  };

  const onInsertImage = () => {
    setImageEditorKey((key) => key + 1);
    setImageEditorOpen(true);
  };

  const onInsertTable = () => {
    setPromptDialog({ kind: "table", url: "", alt: "", rows: 3, columns: 3 });
  };

  const onInsertPageBreak = () => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      selection.insertNodes([$createPageBreakNode()]);
    });
  };

  const confirmPrompt = () => {
    if (!promptDialog) return;
    const { kind, url, rows, columns } = promptDialog;
    const cleanUrl = url.trim();
    if (kind === "link") {
      if (cleanUrl) editor.dispatchCommand(TOGGLE_LINK_COMMAND, cleanUrl);
    } else if (kind === "table") {
      insertTable(editor, {
        rows: Math.max(1, Math.min(rows ?? 3, 20)),
        columns: Math.max(1, Math.min(columns ?? 3, 10)),
      });
    }
    setPromptDialog(null);
  };

  const canConfirmPrompt = (dialog: PromptDialogState): boolean => {
    if (dialog.kind === "table") {
      return (dialog.rows ?? 0) >= 1 && (dialog.columns ?? 0) >= 1;
    }
    return dialog.url.trim().length > 0;
  };

  const applyBlock = (type: BlockType) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      switch (type) {
        case "paragraph":
          $setBlocksType(selection, () => $createParagraphNode());
          break;
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          $setBlocksType(selection, () => $createHeadingNode(type));
          break;
        case "quote":
          $setBlocksType(selection, () => $createQuoteNode());
          break;
        case "code":
          $setBlocksType(selection, () => $createCodeNode());
          break;
        case "ul":
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          break;
        case "ol":
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          break;
        case "check":
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
          break;
        default:
          break;
      }
    });
  };

  const clearFormatting = () => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setTextFormat(selection, {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        highlight: false,
        code: false,
        superscript: false,
        subscript: false,
      });
      $patchStyleText(selection, {
        "font-family": null,
        "font-size": null,
        color: null,
        "background-color": null,
      });
    });
  };

  const applyFontSize = (value: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { "font-size": value || null });
      }
    });
  };

  const applyColor = (property: "color" | "background-color", value: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { [property]: value || null });
      }
    });
  };

  const isCustomColor = (
    value: string,
    presets: readonly { value: string }[],
  ): boolean =>
    value !== "" && !presets.some((preset) => preset.value.toLowerCase() === value.toLowerCase());

  const safeHex = (value: string): string =>
    /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";

  const applyAlignment = (alignment: "left" | "center" | "right" | "justify") => {
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, alignment);
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting tools">
      <div className={styles.toolbarGroup}>
        <Menu
          label="File"
          icon={<FilePlus size={14} strokeWidth={1.8} aria-hidden="true" />}
        >
          {(close) => (
            <>
              <MenuItem
                label="New document"
                icon={<FilePlus size={14} strokeWidth={1.8} aria-hidden="true" />}
                shortcut=""
                onSelect={() => api.newDocument()}
                close={close}
              />
              <MenuItem
                label="Import Markdown…"
                icon={<FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={() => importInputRef.current?.click()}
                close={close}
              />
              <MenuItem
                label="Export Markdown"
                icon={<FileText size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={onExportMarkdown}
                close={close}
              />
              <MenuItem
                label="Export…"
                icon={<FileDown size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={() => {
                  setExportSession((session) => session + 1);
                  setExportOpen(true);
                }}
                close={close}
              />
            </>
          )}
        </Menu>
        <button
          type="button"
          className={styles.saveButton}
          title="Save (Ctrl+S)"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          <Save size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>{saving ? "Saving…" : "Save"}</span>
        </button>
        {showSaved && (
          <span className={styles.savedLabel} aria-live="polite">
            Saved
          </span>
        )}
      </div>

      <div className={styles.toolbarGroup}>
        <HistoryButtons state={state} />
      </div>

      <div className={styles.toolbarGroup}>
        <select
          className={styles.blockSelect}
          value={state.blockType}
          title="Line Type"
          aria-label="Line Type"
          onChange={(event) => applyBlock(event.target.value as BlockType)}
        >
          {HEADING_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.toolbarGroup}>
        <FontFamilySelect />
      </div>

      <div className={styles.toolbarGroup}>
        <select
          className={`${styles.blockSelect} ${styles.fontSizeSelect}`}
          value={state.fontSize || DEFAULT_FONT_SIZE_VALUE}
          title="Font size"
          aria-label="Font size"
          onChange={(event) => applyFontSize(event.target.value)}
        >
          {FONT_SIZE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {paged && (
        <div className={styles.toolbarGroup}>
          <Menu
            label={
              presetMargin !== undefined
                ? (PAGE_MARGIN_OPTIONS.find((option) => option.value === presetMargin)?.label ?? "Margin")
                : "Custom"
            }
          >
            {(close) => (
              <>
                {PAGE_MARGIN_OPTIONS.map(({ value, label }) => (
                  <MenuItem
                    key={value}
                    label={label}
                    checked={presetMargin === value}
                    onSelect={() => onMarginsChange?.(uniformMargins(value))}
                    close={close}
                  />
                ))}
                <MenuItem
                  label="Custom…"
                  checked={presetMargin === undefined}
                  onSelect={() => {
                    setMarginDialogSession((session) => session + 1);
                    setMarginDialogOpen(true);
                  }}
                  close={close}
                />
              </>
            )}
          </Menu>
        </div>
      )}

      <div className={styles.toolbarGroup}>
        <Menu label="Colors" icon={<Palette size={14} strokeWidth={1.8} aria-hidden="true" />}>
          {(close) => (
            <>
              <div className={styles.menuSection}>
                <span className={styles.menuSectionLabel}>Text color</span>
                <div className={styles.swatchRow}>
                  {TEXT_COLORS.map(({ value, label, swatch }) => (
                    <button
                      key={value}
                      type="button"
                      className={[
                        styles.swatch,
                        state.textColor === value ? styles.swatchActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ backgroundColor: swatch }}
                      title={label}
                      aria-label={`Text color ${label}`}
                      onClick={() => applyColor("color", value)}
                    />
                  ))}
                  <button
                    type="button"
                    className={[
                      styles.swatch,
                      styles.customSwatch,
                      isCustomColor(state.textColor, TEXT_COLORS) ? styles.swatchActive : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title="Custom text color…"
                    aria-label="Pick a custom text color"
                    onClick={() => textColorInputRef.current?.click()}
                  />
                  <input
                    ref={textColorInputRef}
                    type="color"
                    className={styles.hiddenColorInput}
                    value={safeHex(state.textColor)}
                    onChange={(event) => applyColor("color", event.target.value)}
                  />
                </div>
              </div>
              <div className={styles.menuSection}>
                <span className={styles.menuSectionLabel}>Highlight</span>
                <div className={styles.swatchRow}>
                  {BACKGROUND_COLORS.map(({ value, label, swatch }) => (
                    <button
                      key={value}
                      type="button"
                      className={[
                        styles.swatch,
                        state.bgColor === value ? styles.swatchActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ backgroundColor: swatch }}
                      title={label}
                      aria-label={`Highlight ${label}`}
                      onClick={() => applyColor("background-color", value)}
                    />
                  ))}
                  <button
                    type="button"
                    className={[
                      styles.swatch,
                      styles.customSwatch,
                      isCustomColor(state.bgColor, BACKGROUND_COLORS) ? styles.swatchActive : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title="Custom highlight…"
                    aria-label="Pick a custom highlight"
                    onClick={() => bgColorInputRef.current?.click()}
                  />
                  <input
                    ref={bgColorInputRef}
                    type="color"
                    className={styles.hiddenColorInput}
                    value={safeHex(state.bgColor)}
                    onChange={(event) => applyColor("background-color", event.target.value)}
                  />
                </div>
              </div>
              <MenuItem
                label="Clear formatting"
                onSelect={clearFormatting}
                close={close}
              />
            </>
          )}
        </Menu>
      </div>

      <div className={styles.toolbarGroup}>
        {LINE_TYPE_OPTIONS.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            className={[
              styles.toolButton,
              state.blockType === value ? styles.toolButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={label}
            aria-label={label}
            aria-pressed={state.blockType === value}
            onClick={() => applyBlock(value)}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className={styles.toolbarGroup}>
        <TextFormatButtons state={state} onToggleLink={onToggleLink} />
      </div>

      <div className={styles.toolbarGroup}>
        {ALIGN_OPTIONS.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            className={[
              styles.toolButton,
              state.alignment === value ? styles.toolButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={label}
            aria-label={label}
            aria-pressed={state.alignment === value}
            onClick={() => applyAlignment(value)}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className={styles.toolbarGroup}>
        <InsertButtons
          onInsertImage={onInsertImage}
          onInsertTable={onInsertTable}
          onInsertPageBreak={paged ? onInsertPageBreak : undefined}
        />
      </div>

      <div className={styles.toolbarSpacer} />

      <div className={styles.toolbarGroup}>
        <button
          type="button"
          className={styles.toolButton}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-pressed={fullscreen}
          onClick={handleToggleFullscreen}
        >
          {fullscreen ? (
            <Minimize size={15} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Maximize size={15} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className={styles.hiddenInput}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = "";
        }}
      />

      <Modal
        open={promptDialog !== null}
        onClose={() => setPromptDialog(null)}
        title={
          promptDialog?.kind === "table" ? "Insert table" : "Add link"
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPromptDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!promptDialog || !canConfirmPrompt(promptDialog)}
              onClick={confirmPrompt}
            >
              {promptDialog?.kind === "link" ? "Apply" : "Insert"}
            </Button>
          </>
        }
      >
        {promptDialog?.kind === "table" ? (
          <div className={styles.tableSizeRow}>
            <div className={styles.promptField}>
              <label className={styles.promptLabel} htmlFor="readlynx-table-rows">
                Rows
              </label>
              <Input
                id="readlynx-table-rows"
                type="number"
                min={1}
                max={20}
                value={promptDialog.rows ?? 3}
                autoFocus
                onChange={(event) =>
                  setPromptDialog((prev) =>
                    prev ? { ...prev, rows: Number(event.target.value) } : prev,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmPrompt();
                }}
              />
            </div>
            <div className={styles.promptField}>
              <label className={styles.promptLabel} htmlFor="readlynx-table-columns">
                Columns
              </label>
              <Input
                id="readlynx-table-columns"
                type="number"
                min={1}
                max={10}
                value={promptDialog.columns ?? 3}
                onChange={(event) =>
                  setPromptDialog((prev) =>
                    prev ? { ...prev, columns: Number(event.target.value) } : prev,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmPrompt();
                }}
              />
            </div>
          </div>
        ) : (
          <div className={styles.promptField}>
            <label className={styles.promptLabel} htmlFor="readlynx-prompt-url">
              Link URL
            </label>
            <Input
              id="readlynx-prompt-url"
              type="url"
              value={promptDialog?.url ?? ""}
              placeholder="https://"
              autoFocus
              onChange={(event) =>
                setPromptDialog((prev) => (prev ? { ...prev, url: event.target.value } : prev))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") confirmPrompt();
              }}
            />
          </div>
        )}
      </Modal>

      <ImageEditorDialog
        key={`image-editor-${imageEditorKey}`}
        open={imageEditorOpen}
        onClose={() => setImageEditorOpen(false)}
        onInsert={(src, width) => insertImage(editor, src, "", width)}
      />

      <ExportDialog
        key={`export-${exportSession}`}
        open={exportOpen}
        editor={editor}
        onClose={() => setExportOpen(false)}
        onExport={runExport}
        defaultMarginMm={pageMargins.top}
        defaultPageFormat={pageFormat}
        coverImage={coverImage}
      />

      <MarginDialog
        key={`margin-${marginDialogSession}`}
        open={marginDialogOpen}
        onClose={() => setMarginDialogOpen(false)}
        format={pageFormat}
        margins={pageMargins}
        onApply={(next) => {
          onMarginsChange?.(next);
          setMarginDialogOpen(false);
        }}
      />
    </div>
  );
}
