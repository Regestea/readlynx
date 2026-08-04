import { useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/Input/Input";
import { ImageEditorDialog } from "../../../components/ui/ImageEditorDialog/ImageEditorDialog";
import { BOOK_TEMPLATES } from "../data/templates";
import type { BookTemplate, CreateBookDetails } from "../data/templates";
import styles from "./CreateBookDialog.module.css";

const COVER_STYLES: Record<BookTemplate["cover"], string> = {
  forest: styles.miniCoverForest,
  moss: styles.miniCoverMoss,
  terracotta: styles.miniCoverTerracotta,
  navy: styles.miniCoverNavy,
  sand: styles.miniCoverSand,
  moon: styles.miniCoverMoon,
};

interface CreateBookDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (details: CreateBookDetails) => void;
}

export function CreateBookDialog({ open, onClose, onConfirm }: CreateBookDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [template, setTemplate] = useState<BookTemplate>(BOOK_TEMPLATES[0]);
  const [title, setTitle] = useState("");
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [coverWidth, setCoverWidth] = useState<number | null>(null);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);

  const handleClose = () => {
    setStep(1);
    setTitle("");
    setCoverSrc(null);
    setCoverWidth(null);
    onClose();
  };

  const handleConfirm = () => {
    onConfirm({ template, title: title.trim(), coverSrc, coverWidth });
    setStep(1);
    setTitle("");
    setCoverSrc(null);
    setCoverWidth(null);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={step === 1 ? "New book" : "Book details"}
        footer={
          step === 1 ? (
            <>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setStep(2)}>
                Next
                <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
                Back
              </Button>
              <Button variant="primary" onClick={handleConfirm} disabled={!title.trim()}>
                Create book
              </Button>
            </>
          )
        }
      >
        {step === 1 ? (
          <div className={styles.step}>
            <p className={styles.hint}>Choose a template to start from — you can change it later.</p>
            <div className={styles.templateGrid}>
              {BOOK_TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.templateCard} ${template.id === item.id ? styles.templateCardActive : ""}`}
                  aria-pressed={template.id === item.id}
                  onClick={() => setTemplate(item)}
                >
                  <span
                    className={`${styles.miniCover} ${item.id === "blank" ? styles.miniCoverBlank : COVER_STYLES[item.cover]}`}
                    aria-hidden="true"
                  >
                    <span className={styles.miniCoverLabel}>{item.id === "blank" ? "Blank" : item.name}</span>
                  </span>
                  <span className={styles.templateBody}>
                    <span className={styles.templateName}>{item.name}</span>
                    <span className={styles.templateDescription}>{item.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.step}>
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
                <div className={styles.coverRow}>
                  <img className={styles.coverPreview} src={coverSrc} alt="Book cover preview" />
                  <div className={styles.coverActions}>
                    <Button variant="secondary" onClick={() => setImageEditorOpen(true)}>
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
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.uploadZone}
                  onClick={() => setImageEditorOpen(true)}
                >
                  <ImagePlus size={22} strokeWidth={1.6} aria-hidden="true" />
                  <span className={styles.uploadText}>Add a cover image</span>
                  <span className={styles.uploadHint}>Crop, resize and adjust it before adding</span>
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ImageEditorDialog
        open={imageEditorOpen}
        onClose={() => setImageEditorOpen(false)}
        onInsert={(src, width) => {
          setCoverSrc(src);
          setCoverWidth(width);
        }}
      />
    </>
  );
}
