import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  FileType,
  FileType2,
  FolderOpen,
  Maximize,
  Minimize,
  Moon,
  Sun,
  FilePlus,
} from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $setTextFormat,
} from "lexical";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { useEditorAPI, useToolbarState } from "../context";
import { HistoryButtons } from "./HistoryButtons";
import { TextFormatButtons } from "./TextFormatButtons";
import { InsertButtons } from "./InsertButtons";
import { FONT_SIZE_OPTIONS, HEADING_OPTIONS, TEXT_COLORS, BACKGROUND_COLORS } from "../constants";
import type { BlockType, EpubFile } from "../types";
import { Modal } from "../../Modal/Modal";
import { Button } from "../../Button/Button";
import styles from "../MarkdownEditor.module.css";

interface ToolbarProps {
  focus: boolean;
  fullscreen: boolean;
  dark: boolean;
  onToggleFocus: () => void;
  onToggleFullscreen: () => void;
  onToggleDark: () => void;
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

/* ---------- Menu primitives ---------- */

function Menu({ label, icon, children }: { label: string; icon?: ReactNode; children: (close: () => void) => ReactNode }) {
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
      {open && <div className={styles.menuPanel}>{children(close)}</div>}
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

const BLOCK_OPTIONS: { value: BlockType; label: string }[] = [
  ...HEADING_OPTIONS.map(({ value, label }) => ({ value: value as BlockType, label })),
  { value: "quote", label: "Quote" },
  { value: "code", label: "Code block" },
  { value: "ul", label: "Bullet list" },
  { value: "ol", label: "Numbered list" },
  { value: "check", label: "Checklist" },
];

export function Toolbar({
  focus,
  fullscreen,
  dark,
  onToggleFocus,
  onToggleFullscreen,
  onToggleDark,
}: ToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const api = useEditorAPI();
  const state = useToolbarState();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [epubFiles, setEpubFiles] = useState<EpubFile[] | null>(null);

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

  const onExportHtml = () => {
    downloadFile("document.html", api.exportHtml(), "text/html;charset=utf-8");
  };

  const onExportEpub = () => {
    setEpubFiles(api.exportEpub({ title: "My Book", author: "ReadLynx" }));
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
                label="Export HTML"
                icon={<FileType size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={onExportHtml}
                close={close}
              />
              <MenuItem
                label="Export EPUB…"
                icon={<FileType2 size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={onExportEpub}
                close={close}
              />
            </>
          )}
        </Menu>
      </div>

      <div className={styles.toolbarGroup}>
        <HistoryButtons state={state} />
      </div>

      <div className={styles.toolbarGroup}>
        <select
          className={styles.blockSelect}
          value={state.blockType}
          title="Block type"
          aria-label="Block type"
          onChange={(event) => applyBlock(event.target.value as BlockType)}
        >
          {BLOCK_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.toolbarGroup}>
        <TextFormatButtons state={state} />
      </div>

      <div className={styles.toolbarGroup}>
        <InsertButtons />
      </div>

      <div className={styles.toolbarSpacer} />

      <div className={styles.toolbarGroup}>
        <Menu label="Format" icon={<FileText size={14} strokeWidth={1.8} aria-hidden="true" />}>
          {(close) => (
            <>
              <div className={styles.menuSection}>
                <span className={styles.menuSectionLabel}>Font size</span>
                <select
                  className={styles.menuSelect}
                  value={state.fontSize}
                  onChange={(event) => applyFontSize(event.target.value)}
                >
                  {FONT_SIZE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
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
        <Menu label="View" icon={<Moon size={14} strokeWidth={1.8} aria-hidden="true" />}>
          {(close) => (
            <>
              <MenuItem
                label={dark ? "Light mode" : "Dark mode"}
                icon={dark ? <Sun size={14} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={onToggleDark}
                close={close}
              />
              <MenuItem
                label={focus ? "Exit focus mode" : "Focus mode"}
                icon={<Maximize size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={onToggleFocus}
                close={close}
              />
              <MenuItem
                label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                icon={fullscreen ? <Minimize size={14} strokeWidth={1.8} aria-hidden="true" /> : <Maximize size={14} strokeWidth={1.8} aria-hidden="true" />}
                onSelect={onToggleFullscreen}
                close={close}
              />
            </>
          )}
        </Menu>
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

      <Modal open={epubFiles !== null} onClose={() => setEpubFiles(null)} title="EPUB export (EPUB 3 files)">
        <div className={styles.epubList}>
          {epubFiles?.map((file) => (
            <div key={file.path} className={styles.epubRow}>
              <span className={styles.epubPath}>{file.path}</span>
              <Button
                variant="ghost"
                onClick={() => downloadFile(file.path.replace(/\//g, "_"), file.content, file.mime)}
              >
                <Download size={14} strokeWidth={1.8} aria-hidden="true" /> Download
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
