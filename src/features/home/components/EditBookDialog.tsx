import { useState } from "react";
import { ImagePlus, Loader2, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { ImageEditorDialog } from "../../../components/ImageEditorDialog/ImageEditorDialog";
import type { Book, CoverStyle } from "../../../shared/types";
import type { BookListItem } from "../../../infrastructure/db/entities/types";
import styles from "./EditBookDialog.module.css";

interface EditBookDialogProps {
  open: boolean;
  /** The book being edited, or null when the dialog is closed. */
  book: Book | null;
  onClose: () => void;
  /** Called with the updated list row after a successful save. */
  onSaved: (updated: BookListItem) => void;
}

const COVER_CLASSES: Record<CoverStyle, string> = {
  forest: styles.coverForest,
  moss: styles.coverMoss,
  terracotta: styles.coverTerracotta,
  navy: styles.coverNavy,
  sand: styles.coverSand,
  moon: styles.coverMoon,
};

/** Mounted with a `key` per book id, so state initializes fresh for each book. */
export function EditBookDialog({ open, book, onClose, onSaved }: EditBookDialogProps) {
  const [title, setTitle] = useState(() => book?.title ?? "");
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverTouched, setCoverTouched] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Loads the stored cover as a data URL and opens the image editor with it.
   *  Books without a cover start the editor in file-pick mode. */
  const openCoverEditor = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const path = book?.coverPath ?? null;
      const src = path ? ((await window.readlynx?.readCoverDataUrl(path)) ?? null) : null;
      setEditSrc(src);
      setEditorKey((key) => key + 1);
      setEditorOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (busy || !book || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const coverImage = coverTouched ? coverSrc : (book.coverPath ?? null);
      const updated = await window.readlynx?.db.updateBook({
        bookId: book.id,
        title: title.trim(),
        coverImage,
      });
      if (!updated) {
        throw new Error("Could not save the book.");
      }
      onSaved(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const currentCover = coverTouched ? coverSrc : (book?.coverImage ?? null);
  const previewTitle = title.trim() || book?.title || "Untitled";
  const paletteCover = book ? COVER_CLASSES[book.cover] : COVER_CLASSES.moss;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Edit book"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleSave()} disabled={!title.trim() || busy}>
              {busy ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </>
        }
      >
        <div className={styles.previewLayout}>
          <div
            className={`${styles.coverPreview} ${currentCover ? styles.coverPreviewWithImage : paletteCover}`}
            aria-hidden="true"
          >
            {currentCover && <img className={styles.coverPreviewImage} src={currentCover} alt="" />}
            <span className={styles.coverPreviewTitle}>{previewTitle}</span>
          </div>

          <div className={styles.fields}>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Title</span>
              <Input
                leading={<NotebookPen size={16} strokeWidth={1.8} aria-hidden="true" />}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Your book title"
                aria-label="Book title"
                autoFocus
              />
            </div>

            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Cover</span>
              {currentCover ? (
                <div className={styles.coverActions}>
                  <Button variant="secondary" onClick={() => void openCoverEditor()} disabled={busy}>
                    <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
                    Edit cover
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setCoverSrc(null);
                      setCoverTouched(true);
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.uploadZone}
                  onClick={() => void openCoverEditor()}
                  disabled={busy}
                >
                  <ImagePlus size={22} strokeWidth={1.6} aria-hidden="true" />
                  <span className={styles.uploadText}>Add a cover image</span>
                  <span className={styles.uploadHint}>Crop, resize and adjust it before adding</span>
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

      <ImageEditorDialog
        key={editorKey}
        open={editorOpen}
        initialSrc={editSrc}
        onClose={() => setEditorOpen(false)}
        onInsert={(src) => {
          setCoverSrc(src);
          setCoverTouched(true);
          setEditorOpen(false);
        }}
      />
    </>
  );
}