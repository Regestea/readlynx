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

  if (src !== renderedSrc) {
    setRenderedSrc(src);
    setStatus(src ? "loading" : "error");
  }

  return (
    <div className={`${styles.frame} ${className}`} style={{ aspectRatio }}>
      {src && (
        <img
          src={src}
          alt={alt}
          className={status === "loaded" ? styles.img : styles.imgHidden}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      )}
      {status !== "loaded" && (
        <div className={styles.placeholder} role="img" aria-label={alt}>
          <ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />
          <span>{status === "loading" ? "Loading…" : "No image"}</span>
        </div>
      )}
    </div>
  );
}
