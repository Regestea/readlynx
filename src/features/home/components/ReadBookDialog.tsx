import { useRef, useState } from "react";
import { BookOpen, FileText, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { FirstPageCover } from "./FirstPageCover";
import type { FirstPageCoverHandle } from "./FirstPageCover";
import type { BookSourceType } from "../../../infrastructure/db/entities/types";
import styles from "./ReadBookDialog.module.css";

interface ReadBookDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the id of the created reading book (which opens in the reader). */
  onConfirm: (bookId: string) => void;
}

export function ReadBookDialog({ open, onClose, onConfirm }: ReadBookDialogProps) {
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<BookSourceType>("pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const coverRef = useRef<FirstPageCoverHandle>(null);

  const resetForm = () => {
    setTitle("");
    setSourcePath(null);
    setSourceType("pdf");
    setCoverImage(null);
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
    setCoverImage(null);
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
      const coverImageForSave = coverImage ?? ((await coverRef.current?.captureFirstPage()) ?? null);
      const result = await window.readlynx?.db.createReadingBook({
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
      title="Add a reading book"
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
                Adding…
              </>
            ) : (
              "Add to shelf"
            )}
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <FirstPageCover
          key={sourcePath ?? "no-source"}
          ref={coverRef}
          sourcePath={sourcePath}
          sourceType={sourceType}
          title={title}
          busy={busy}
          emptyIcon={<BookOpen size={26} strokeWidth={1.6} aria-hidden="true" />}
          onPick={() => void handlePick()}
          onCoverChange={(change) => setCoverImage(change.src)}
          onError={(message) => setError(message)}
        />

        <div className={styles.fields}>
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Title</span>
            <Input
              leading={<BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Reading book title"
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
