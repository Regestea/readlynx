import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Code,
  Download,
  FileText,
  FileType,
  FileType2,
  FolderOpen,
  List,
  ListChecks,
  ListOrdered,
  Maximize,
  Minimize,
  FilePlus,
  Quote,
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
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useEditorAPI, useToolbarState } from "../context";
import { HistoryButtons } from "./HistoryButtons";
import { TextFormatButtons } from "./TextFormatButtons";
import { InsertButtons } from "./InsertButtons";
import { insertImage } from "../plugins/ImagePlugin";
import { insertTable } from "../plugins/TablePlugin";
import { ImageEditorDialog } from "./ImageEditorDialog";
import { FONT_SIZE_OPTIONS, HEADING_OPTIONS, TEXT_COLORS, BACKGROUND_COLORS } from "../constants";
import type { BlockType, EpubFile } from "../types";
import { Modal } from "../../Modal/Modal";
import { Button } from "../../Button/Button";
import { Input } from "../../Input/Input";
import styles from "../DocumentEditor.module.css";

interface ToolbarProps {
  fullscreen: boolean;
  onToggleFullscreen: (editorState: string) => void;
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

export function Toolbar({ fullscreen, onToggleFullscreen }: ToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const api = useEditorAPI();
  const state = useToolbarState();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [epubFiles, setEpubFiles] = useState<EpubFile[] | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptDialogState | null>(null);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [imageEditorKey, setImageEditorKey] = useState(0);

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

  const onExportHtml = () => {
    downloadFile("document.html", api.exportHtml(), "text/html;charset=utf-8");
  };

  const onExportEpub = () => {
    setEpubFiles(api.exportEpub({ title: "My Book", author: "ReadLynx" }));
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
        <InsertButtons onInsertImage={onInsertImage} onInsertTable={onInsertTable} />
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
        key={imageEditorKey}
        open={imageEditorOpen}
        onClose={() => setImageEditorOpen(false)}
        onInsert={(src, width) => insertImage(editor, src, "", width)}
      />
    </div>
  );
}
