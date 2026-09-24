import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { ImageIcon, Loader2, Pencil, X } from "lucide-react";
import { PdfViewer } from "../../../components/pdfViewer/PdfViewer";
import { ImageEditorDialog } from "../../../components/ImageEditorDialog/ImageEditorDialog";
import type { BookSourceType } from "../../../infrastructure/db/entities/types";
import { randomCover } from "./coverOptions";
import type { CoverOption } from "./coverOptions";
import styles from "./FirstPageCover.module.css";

export type CoverSource = "capture" | "custom";

export interface FirstPageCoverChange {
  src: string | null;
  source: CoverSource | null;
}

export interface FirstPageCoverHandle {
  /** High-res first-page snapshot used as the cover when no custom image was
   *  chosen. PDF only — EPUBs never auto-capture, the user picks an image. */
  captureFirstPage(): Promise<string | null>;
}

interface FirstPageCoverProps {
  sourcePath: string | null;
  sourceType: BookSourceType;
  /** Book title shown on the EPUB placeholder cover. */
  title?: string;
  /** Disables the cover buttons while the host dialog is busy. */
  busy?: boolean;
  /** Icon shown in the empty (no file yet) state. */
  emptyIcon?: ReactNode;
  /** Called when the empty state is clicked — opens the file picker. */
  onPick?: () => void;
  /** Reports the current cover image and its origin. */
  onCoverChange?: (change: FirstPageCoverChange) => void;
  /** Capture failures are surfaced here so the host can display them. */
  onError?: (message: string | null) => void;
}

const COVER_CLASSES: Record<CoverOption, string> = {
  forest: styles.coverForest,
  moss: styles.coverMoss,
  terracotta: styles.coverTerracotta,
  navy: styles.coverNavy,
  sand: styles.coverSand,
  moon: styles.coverMoon,
};

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

/** Shared cover picker for the reading/translate dialogs. PDFs preview the
 *  first page and can use it as the cover; EPUB and Markdown books show a
 *  shelf-style colored placeholder until the user picks an image. Hosts
 *  should mount it with `key={sourcePath}` so its state resets when the file
 *  changes. */
export function FirstPageCover({
  sourcePath,
  sourceType,
  busy = false,
  emptyIcon,
  onPick,
  onCoverChange,
  onError,
  ref,
}: FirstPageCoverProps & { ref?: Ref<FirstPageCoverHandle> }) {
  const [previewReady, setPreviewReady] = useState(false);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverSource, setCoverSource] = useState<CoverSource | null>(null);
  const [paletteCover] = useState<CoverOption>(() => randomCover());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewReadyRef = useRef(false);
  const snapshotRef = useRef<string | null>(null);
  const editorSourceRef = useRef<CoverSource>("capture");
  const onCoverChangeRef = useRef(onCoverChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCoverChangeRef.current = onCoverChange;
  }, [onCoverChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    previewReadyRef.current = previewReady;
  }, [previewReady]);

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

  /** High-resolution first page of a PDF, used as the cover source. EPUB and
   *  Markdown books have no auto-capture — the user always picks their own image. */
  const captureHighRes = async (): Promise<string | null> => {
    if (sourceType !== "pdf") return null;
    if (snapshotRef.current) return snapshotRef.current;
    await waitUntil(() => Boolean(snapshotRef.current), 3000);
    if (snapshotRef.current) return snapshotRef.current;
    return captureStage(previewRef.current);
  };

  useImperativeHandle(ref, () => ({ captureFirstPage: captureHighRes }));

  /** Opens the image editor. PDFs can auto-capture the first page first;
   *  EPUB and Markdown books always edit the current cover or start in
   *  file-pick mode. */
  const openCoverEditor = async (source: CoverSource = "capture") => {
    if (busy || capturing) return;
    setCapturing(true);
    try {
      let src: string | null = null;
      if (source === "capture") {
        if (sourceType !== "pdf") {
          src = coverImage;
        } else {
          const hi = await captureHighRes();
          if (!hi) {
            onErrorRef.current?.("Could not capture the first page. Try again.");
            return;
          }
          src = hi;
        }
      } else if (sourceType !== "pdf") {
        src = coverImage;
      }
      onErrorRef.current?.(null);
      setEditSrc(src);
      editorSourceRef.current = source;
      setEditorKey((key) => key + 1);
      setEditorOpen(true);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <>
      <div className={styles.previewCol}>
        <span className={styles.previewLabel}>
          {sourceType === "pdf" ? "Cover — first page of the book" : "Cover"}
        </span>
        <div className={styles.previewFrame}>
          {sourcePath ? (
            <div className={styles.previewBody}>
              <div ref={previewRef} className={styles.previewStage}>
                {sourceType === "pdf" ? (
                  <PdfViewer
                    key={`pdf-${sourcePath}`}
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
                  <div
                    className={`${styles.coverPlaceholder} ${COVER_CLASSES[paletteCover]}`}
                    aria-hidden="true"
                  />
                )}
                {coverImage && (
                  <img src={coverImage} alt="Edited cover" className={styles.coverPreview} />
                )}
              </div>
              {sourceType === "pdf" && !previewReady && (
                <div className={styles.previewLoading} aria-hidden="true">
                  <Loader2 size={18} strokeWidth={2} className={styles.spinner} />
                  <span>Rendering first page…</span>
                </div>
              )}
              <div className={styles.coverActions}>
                {sourceType === "pdf" ? (
                  <>
                    <button
                      type="button"
                      className={styles.coverAction}
                      onClick={() => void openCoverEditor("capture")}
                      disabled={busy || capturing}
                    >
                      <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                      {coverImage ? "Retake / edit cover" : "Edit cover"}
                    </button>
                    <button
                      type="button"
                      className={styles.coverAction}
                      onClick={() => void openCoverEditor("custom")}
                      disabled={busy || capturing}
                    >
                      <ImageIcon size={13} strokeWidth={2} aria-hidden="true" />
                      Choose image
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.coverAction}
                    onClick={() => void openCoverEditor("custom")}
                    disabled={busy || capturing}
                  >
                    <ImageIcon size={13} strokeWidth={2} aria-hidden="true" />
                    {coverImage ? "Edit cover" : "Choose cover image"}
                  </button>
                )}
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
                      onCoverChangeRef.current?.({ src: null, source: null });
                    }}
                    aria-label="Remove the cover image"
                    title="Remove the cover image"
                  >
                    <X size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          ) : (
            <button type="button" className={styles.previewEmpty} onClick={onPick}>
              {emptyIcon}
              <span>First page preview</span>
              <span className={styles.previewEmptyHint}>Choose a PDF, EPUB or Markdown file to see it here</span>
            </button>
          )}
        </div>
      </div>

      <ImageEditorDialog
        key={editorKey}
        open={editorOpen}
        initialSrc={editSrc}
        onClose={() => setEditorOpen(false)}
        onInsert={(src) => {
          setCoverImage(src);
          setCoverSource(editorSourceRef.current);
          onCoverChangeRef.current?.({ src, source: editorSourceRef.current });
          setEditorOpen(false);
        }}
      />
    </>
  );
}