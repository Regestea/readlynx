import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Languages, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { PdfViewer } from "../../../components/PdfViewer/PdfViewer";
import { EpubViewer } from "../../../components/EpubViewer/EpubViewer";
import type { BookSourceType } from "../../../db/entities/types";
import styles from "./TranslateBookDialog.module.css";

interface TranslateBookDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the id of the created book (which opens in the editor). */
  onConfirm: (bookId: string) => void;
}

const PREVIEW_WAIT_TIMEOUT = 10000;

export function TranslateBookDialog({ open, onClose, onConfirm }: TranslateBookDialogProps) {
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<BookSourceType>("pdf");
  const [previewKey, setPreviewKey] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewReadyRef = useRef(false);

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
    setPreviewKey((key) => key + 1);
  };

  const captureCover = async (): Promise<string | null> => {
    const el = previewRef.current;
    if (!el) return null;
    const deadline = Date.now() + PREVIEW_WAIT_TIMEOUT;
    while (!previewReadyRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  const handleConfirm = async () => {
    if (busy || !sourcePath || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await window.readlynx?.importSource({ sourcePath, sourceType });
      if (!imported) {
        throw new Error("Could not copy the book file into the app.");
      }
      const coverImage = await captureCover();
      const result = await window.readlynx?.db.createTranslatedBook({
        title: title.trim(),
        sourceType,
        sourcePath: imported,
        coverImage,
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
                </div>
                {!previewReady && (
                  <div className={styles.previewLoading} aria-hidden="true">
                    <Loader2 size={18} strokeWidth={2} className={styles.spinner} />
                    <span>Rendering first page…</span>
                  </div>
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
    </Modal>
  );
}