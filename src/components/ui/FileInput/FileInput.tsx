import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { FileText, Upload, X } from "lucide-react";
import { formatBytes } from "../../../shared/utils";
import styles from "./FileInput.module.css";

export function FileInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    if (next?.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(next));
    } else {
      setPreview(null);
    }
  };

  const handleRemove = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        type="file"
        className={styles.input}
        accept=".pdf,.epub,.txt,image/*"
        onChange={handleChange}
        aria-label="Upload a file"
      />
      {file ? (
        <div className={styles.fileRow}>
          {preview ? (
            <img className={styles.preview} src={preview} alt="Upload preview" />
          ) : (
            <span className={styles.fileIcon} aria-hidden="true">
              <FileText size={18} strokeWidth={1.8} />
            </span>
          )}
          <div className={styles.fileMeta}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{formatBytes(file.size)}</span>
          </div>
          <button
            type="button"
            className={styles.remove}
            onClick={handleRemove}
            aria-label="Remove selected file"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.drop}
          onClick={() => inputRef.current?.click()}
        >
          <span className={styles.dropIcon} aria-hidden="true">
            <Upload size={20} strokeWidth={1.8} />
          </span>
          <span className={styles.dropTitle}>Drop your book here or browse</span>
          <span className={styles.dropMeta}>PDF, EPUB, TXT or images up to 50 MB</span>
        </button>
      )}
    </div>
  );
}
