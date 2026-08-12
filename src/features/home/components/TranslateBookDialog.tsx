import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, FolderOpen, ImageIcon, Languages, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { PdfViewer } from "../../../components/pdfViewer/PdfViewer";
import { EpubViewer } from "../../../components/epubViewer/EpubViewer";
import { ImageEditorDialog } from "../../../components/ui/ImageEditorDialog/ImageEditorDialog";
import type { BookSourceType } from "../../../infrastructure/db/entities/types";
import styles from "./TranslateBookDialog.module.css";

interface TranslateBookDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the id of the created book (which opens in the editor). */
  onConfirm: (bookId: string) => void;
}

const PREVIEW_WAIT_TIMEOUT = 10000;

function waitUntil(predicate: () => boolean, timeout: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(false);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

export function TranslateBookDialog({ open, onClose, onConfirm }: TranslateBookDialogProps) {
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<BookSourceType>("pdf");
  const [previewKey, setPreviewKey] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverSource, setCoverSource] = useState<"capture" | "custom" | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewReadyRef = useRef(false);
  const snapshotRef = useRef<string | null>(null);
  const captureReadyRef = useRef(false);
  const captureViewportRef = useRef<HTMLDivElement>(null);
  const editorSourceRef = useRef<"capture" | "custom">("capture");

  useEffect(() => {
    previewReadyRef.current = previewReady;
  }, [previewReady]);

  const resetForm = () => {
    setTitle("");
    setSourcePath(null);
    setSourceType("pdf");
    setPreviewKey(0);
    setPreviewReady(false);
    previewReadyRef.current = false;
    snapshotRef.current = null;
    setCoverImage(null);
    setCoverSource(null);
    setEditSrc(null);
    setEditorOpen(false);
    setCaptureOpen(false);
    captureReadyRef.current = false;
    setBusy(false);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handlePick = async () => {
    const picked = await window.readlynx?.pickFile({
      filters: [{ name: "PDF or EPUB book", extensions: ["pdf", "epub"] }],
    });
    if (!picked) return;
    setSourcePath(picked);
    setSourceType(picked.toLowerCase().endsWith(".pdf") ? "pdf" : "epub");
    setPreviewReady(false);
    previewReadyRef.current = false;
    snapshotRef.current = null;
    setCoverImage(null);
    setCoverSource(null);
    setEditSrc(null);
    setPreviewKey((key) => key + 1);
  };

  const captureStage = async (el: HTMLElement | null): Promise<string | null> => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const dataUrl = await window.readlynx?.captureRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      if (dataUrl) return dataUrl;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return null;
  };

  /** High-resolution first-page image, used as the cover source. */
  const captureHighRes = async (): Promise<string | null> => {
    if (sourceType === "pdf") {
      if (snapshotRef.current) return snapshotRef.current;
      await waitUntil(() => Boolean(snapshotRef.current), 3000);
      if (snapshotRef.current) return snapshotRef.current;
      return captureStage(previewRef.current);
    }
    const viewport = captureViewportRef.current;
    if (!viewport) return null;
    captureReadyRef.current = false;
    setCaptureOpen(true);
    setCaptureKey((key) => key + 1);
    const ready = await waitUntil(() => captureReadyRef.current, PREVIEW_WAIT_TIMEOUT);
    if (!ready) {
      setCaptureOpen(false);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rect = viewport.getBoundingClientRect();
    let dataUrl: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const captured = await window.readlynx?.captureRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      if (captured) {
        dataUrl = captured;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    setCaptureOpen(false);
    return dataUrl;
  };

  /** Opens the image editor. With `source: "capture"` it loads the high-res
   *  first page of the book; with `source: "custom"` it starts in file-pick
   *  mode so the user can bring their own image instead. */
  const openCoverEditor = async (source: "capture" | "custom" = "capture") => {
    if (busy || !sourcePath) return;
    setBusy(true);
    try {
      let src: string | null = null;
      if (source === "capture") {
        const hi = await captureHighRes();
        if (!hi) {
          setError("Could not capture the first page. Try again.");
          return;
        }
        src = hi;
      }
      setEditSrc(src);
      editorSourceRef.current = source;
      setEditorKey((key) => key + 1);
      setEditorOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (busy || !sourcePath || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await window.readlynx?.importSource({ sourcePath, sourceType });
      if (!imported) {
        throw new Error("Could not copy the book file into the app.");
      }
      const coverImageForSave = coverImage ?? (await captureHighRes());
      const result = await window.readlynx?.db.createTranslatedBook({
        title: title.trim(),
        sourceType,
        sourcePath: imported,
        coverImage: coverImageForSave,
      });
      if (!result) {
        throw new Error("Could not create the book.");
      }
      resetForm();
      onConfirm(result.bookId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sourceName = sourcePath ? sourcePath.split(/[\\/]/).pop() ?? sourcePath : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Translate book"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleConfirm()} disabled={!title.trim() || !sourcePath || busy}>
            {busy ? (
              <>
                <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
                Creating…
              </>
            ) : (
              "Create book"
            )}
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.previewCol}>
          <span className={styles.previewLabel}>Cover — first page of the book</span>
          <div className={styles.previewFrame}>
            {sourcePath ? (
              <div className={styles.previewBody}>
                <div ref={previewRef} className={styles.previewStage}>
                  {sourceType === "pdf" ? (
                    <PdfViewer
                      key={`pdf-${previewKey}`}
                      filePath={sourcePath}
                      fill
                      toolbar={false}
                      fit
onReady={() => setPreviewReady(true)}
                  onPageSnapshot={(src) => {
                    snapshotRef.current = src;
                  }}
                />
              ) : (
                <EpubViewer
                  key={`epub-${previewKey}`}
                  filePath={sourcePath}
                  fill
                  toolbar={false}
                  onReady={() => setPreviewReady(true)}
                />
              )}
              {coverImage && (
                <img src={coverImage} alt="Edited cover" className={styles.coverPreview} />
              )}
            </div>
            {!previewReady && (
              <div className={styles.previewLoading} aria-hidden="true">
                <Loader2 size={18} strokeWidth={2} className={styles.spinner} />
                <span>Rendering first page…</span>
              </div>
            )}
            <div className={styles.coverActions}>
              <button
                type="button"
                className={styles.coverAction}
                onClick={() => void openCoverEditor("capture")}
                disabled={busy}
              >
                <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                {coverImage ? "Retake / edit cover" : "Edit cover"}
              </button>
              <button
                type="button"
                className={styles.coverAction}
                onClick={() => void openCoverEditor("custom")}
                disabled={busy}
              >
                <ImageIcon size={13} strokeWidth={2} aria-hidden="true" />
                Choose image
              </button>
            </div>
            {coverImage && (
              <>
                <span className={styles.coverBadge}>
                  {coverSource === "custom" ? "Custom cover" : "Edited"}
                </span>
                <button
                  type="button"
                  className={styles.removeCover}
                  onClick={() => {
                    setCoverImage(null);
                    setCoverSource(null);
                  }}
                  aria-label="Remove custom cover and use the first page"
                  title="Use the first page as the cover"
                >
                  <X size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        ) : (
              <button type="button" className={styles.previewEmpty} onClick={() => void handlePick()}>
                <Languages size={26} strokeWidth={1.6} aria-hidden="true" />
                <span>First page preview</span>
                <span className={styles.previewEmptyHint}>Choose a PDF or EPUB to see it here</span>
              </button>
            )}
          </div>
        </div>

        <div className={styles.fields}>
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Title</span>
            <Input
              leading={<Languages size={16} strokeWidth={1.8} aria-hidden="true" />}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Translated book title"
              aria-label="Book title"
              autoFocus
            />
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Source file</span>
            {sourcePath ? (
              <div className={styles.fileRow}>
                <span className={styles.fileIcon} aria-hidden="true">
                  <FileText size={18} strokeWidth={1.8} />
                </span>
                <span className={styles.fileMeta}>
                  <span className={styles.fileName}>{sourceName}</span>
                  <span className={styles.fileType}>
                    {sourceType === "pdf" ? "PDF document" : "EPUB book"}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.fileAction}
                  onClick={() => void handlePick()}
                  aria-label="Choose another file"
                  title="Choose another file"
                >
                  <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button type="button" className={styles.pickZone} onClick={() => void handlePick()}>
                <FolderOpen size={20} strokeWidth={1.8} aria-hidden="true" />
                <span className={styles.pickTitle}>Choose a PDF or EPUB file</span>
                <span className={styles.pickHint}>The file is copied into the app and its first page becomes the cover</span>
              </button>
            )}
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      {captureOpen &&
        createPortal(
          <div className={styles.captureOverlay}>
            <div className={styles.captureBar}>
              <Loader2 size={16} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
              Capturing first page…
            </div>
            <div className={styles.captureViewport} ref={captureViewportRef}>
              <EpubViewer
                key={`cap-${captureKey}`}
                filePath={sourcePath as string}
                fill
                toolbar={false}
                onReady={() => {
                  captureReadyRef.current = true;
                }}
              />
            </div>
          </div>,
          document.body,
        )}

      <ImageEditorDialog
        key={editorKey}
        open={editorOpen}
        initialSrc={editSrc}
        onClose={() => setEditorOpen(false)}
        onInsert={(src) => {
          setCoverImage(src);
          setCoverSource(editorSourceRef.current);
          setEditorOpen(false);
        }}
      />
    </Modal>
  );
}