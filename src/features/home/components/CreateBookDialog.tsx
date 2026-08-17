import { useState } from "react";
import { ImagePlus, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { ImageEditorDialog } from "../../../components/ImageEditorDialog/ImageEditorDialog";
import { randomCover } from "./coverOptions";
import type { CoverOption } from "./coverOptions";
import styles from "./CreateBookDialog.module.css";

export interface CreateBookDetails {
  title: string;
  coverSrc: string | null;
  coverWidth: number | null;
}

interface CreateBookDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (details: CreateBookDetails) => void;
}

const COVER_CLASSES: Record<CoverOption, string> = {
  forest: styles.coverForest,
  moss: styles.coverMoss,
  terracotta: styles.coverTerracotta,
  navy: styles.coverNavy,
  sand: styles.coverSand,
  moon: styles.coverMoon,
};

export function CreateBookDialog({ open, onClose, onConfirm }: CreateBookDialogProps) {
  const [title, setTitle] = useState("");
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverWidth, setCoverWidth] = useState<number | null>(null);
  const [coverColor, setCoverColor] = useState<CoverOption>(() => randomCover());
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const openImageEditor = () => {
    setEditorKey((key) => key + 1);
    setImageEditorOpen(true);
  };

  const resetForm = () => {
    setTitle("");
    setCoverSrc(null);
    setCoverWidth(null);
    setCoverColor(randomCover());
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleConfirm = () => {
    onConfirm({ title: title.trim(), coverSrc, coverWidth });
    resetForm();
  };

  const previewTitle = title.trim() || "Untitled";

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title="New book"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={!title.trim()}>
              Create book
            </Button>
          </>
        }
      >
        <div className={styles.previewLayout}>
          <div
            className={`${styles.coverPreview} ${coverSrc ? styles.coverPreviewWithImage : COVER_CLASSES[coverColor]}`}
            aria-hidden="true"
          >
            {coverSrc && <img className={styles.coverPreviewImage} src={coverSrc} alt="" />}
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
              {coverSrc ? (
                <div className={styles.coverActions}>
                  <Button variant="secondary" onClick={openImageEditor}>
                    <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
                    Edit cover
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCoverSrc(null);
                      setCoverWidth(null);
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
                  onClick={openImageEditor}
                >
                  <ImagePlus size={22} strokeWidth={1.6} aria-hidden="true" />
                  <span className={styles.uploadText}>Add a cover image</span>
                  <span className={styles.uploadHint}>Crop, resize and adjust it before adding</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <ImageEditorDialog
        key={editorKey}
        open={imageEditorOpen}
        initialSrc={coverSrc}
        onClose={() => setImageEditorOpen(false)}
        onInsert={(src, width) => {
          setCoverSrc(src);
          setCoverWidth(width);
        }}
      />
    </>
  );
}
