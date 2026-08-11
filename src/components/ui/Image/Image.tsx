import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import styles from "./Image.module.css";

interface ImageProps {
  src?: string;
  alt: string;
  aspectRatio?: string;
  className?: string;
}

type ImageStatus = "loading" | "loaded" | "error";

export function Image({ src, alt, aspectRatio = "4 / 3", className = "" }: ImageProps) {
  const [renderedSrc, setRenderedSrc] = useState(src);
  const [status, setStatus] = useState<ImageStatus>(() => (src ? "loading" : "error"));
  const [ratio, setRatio] = useState(aspectRatio);

  if (src !== renderedSrc) {
    setRenderedSrc(src);
    setStatus(src ? "loading" : "error");
    setRatio(aspectRatio);
  }

  return (
    <span className={`${styles.frame} ${className}`} style={{ aspectRatio: ratio }}>
      {src && (
        <img
          src={src}
          alt={alt}
          className={status === "loaded" ? styles.img : styles.imgHidden}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
            }
            setStatus("loaded");
          }}
          onError={() => setStatus("error")}
        />
      )}
      {status !== "loaded" && (
        <span className={styles.placeholder} role="img" aria-label={alt}>
          <ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />
          <span>{status === "loading" ? "Loading…" : "No image"}</span>
        </span>
      )}
    </span>
  );
}
