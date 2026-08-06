import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  ImagePlus,
  Lock,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Unlock,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "../Button/Button";
import { Modal } from "../Modal/Modal";
import styles from "./ImageEditorDialog.module.css";

interface ImageEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (src: string, width: number | null) => void;
  /** Load this image instead of requiring an upload (e.g. a captured cover). */
  initialSrc?: string | null;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_CROP = 16;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ImageEditorDialog({ open, onClose, onInsert, initialSrc }: ImageEditorDialogProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [steps, setSteps] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lockRatio, setLockRatio] = useState(true);
  const [sizeTouched, setSizeTouched] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [grayscale, setGrayscale] = useState(false);
  const [zoom, setZoom] = useState(1);

  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const previewRowRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);

  const oriented = useMemo(() => {
    if (!img) return null;
    return steps % 2 === 1
      ? { w: img.naturalHeight, h: img.naturalWidth }
      : { w: img.naturalWidth, h: img.naturalHeight };
  }, [img, steps]);

  const displayScale = useMemo(() => {
    if (!oriented) return 1;
    return Math.min(1, 520 / oriented.w, 360 / oriented.h);
  }, [oriented]);

  const viewScale = displayScale * zoom;

  const loadDataUrl = (data: string) => {
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setSteps(0);
      setFlipH(false);
      setFlipV(false);
      setCrop({ x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight });
      setWidth(image.naturalWidth);
      setHeight(image.naturalHeight);
      setSizeTouched(false);
      setBrightness(100);
      setContrast(100);
      setGrayscale(false);
      setZoom(1);
    };
    image.src = data;
  };

  const onFile = (file: File | null | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      loadDataUrl(String(reader.result ?? ""));
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (open && initialSrc) {
      loadDataUrl(initialSrc);
    }
  }, [open, initialSrc]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !img || !oriented) return;
    canvas.width = oriented.w;
    canvas.height = oriented.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)${grayscale ? " grayscale(1)" : ""}`;
    ctx.translate(oriented.w / 2, oriented.h / 2);
    ctx.rotate((steps * Math.PI) / 2);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [img, steps, flipH, flipV, brightness, contrast, grayscale, oriented]);

  const cropW = crop?.w ?? oriented?.w ?? 0;
  const cropH = crop?.h ?? oriented?.h ?? 0;
  const cropAspect = cropW > 0 ? cropH / cropW : 1;

  const syncSizeToCrop = (rect: CropRect) => {
    setCrop(rect);
    if (!sizeTouched) {
      setWidth(Math.round(rect.w));
      setHeight(Math.round(rect.h));
    }
  };

  const startCropDrag = (mode: DragMode, event: React.MouseEvent) => {
    if (!oriented) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = crop ?? { x: 0, y: 0, w: oriented.w, h: oriented.h };

    const onMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / viewScale;
      const dy = (moveEvent.clientY - startY) / viewScale;
      if (mode === "move") {
        syncSizeToCrop({
          x: clamp(Math.round(start.x + dx), 0, Math.max(0, oriented.w - start.w)),
          y: clamp(Math.round(start.y + dy), 0, Math.max(0, oriented.h - start.h)),
          w: start.w,
          h: start.h,
        });
        return;
      }
      let x1 = start.x;
      let y1 = start.y;
      let x2 = start.x + start.w;
      let y2 = start.y + start.h;
      if (mode.includes("w")) {
        x1 = clamp(Math.round(Math.min(start.x + dx, start.x + start.w)), 0, oriented.w);
      }
      if (mode.includes("e")) {
        x2 = clamp(Math.round(Math.max(start.x + dx, start.x)), 0, oriented.w);
      }
      if (mode.includes("n")) {
        y1 = clamp(Math.round(Math.min(start.y + dy, start.y + start.h)), 0, oriented.h);
      }
      if (mode.includes("s")) {
        y2 = clamp(Math.round(Math.max(start.y + dy, start.y)), 0, oriented.h);
      }
      const nextW = x2 - x1;
      const nextH = y2 - y1;
      if (nextW >= MIN_CROP && nextH >= MIN_CROP) {
        syncSizeToCrop({ x: x1, y: y1, w: nextW, h: nextH });
      } else if (nextW >= MIN_CROP) {
        syncSizeToCrop({ x: x1, y: start.y, w: nextW, h: start.h });
      } else if (nextH >= MIN_CROP) {
        syncSizeToCrop({ x: start.x, y: y1, w: start.w, h: nextH });
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const startPan = (event: React.PointerEvent) => {
    const container = previewRowRef.current;
    if (!container) return;
    event.preventDefault();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startScrollLeft = container.scrollLeft;
    const startScrollTop = container.scrollTop;
    setPanning(true);

    const onMove = (moveEvent: PointerEvent) => {
      container.scrollLeft = startScrollLeft - (moveEvent.clientX - startClientX);
      container.scrollTop = startScrollTop - (moveEvent.clientY - startClientY);
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const rotate = (dir: 1 | -1) => {
    if (!img) return;
    const next = (steps + dir + 4) % 4;
    const nextW = next % 2 === 1 ? img.naturalHeight : img.naturalWidth;
    const nextH = next % 2 === 1 ? img.naturalWidth : img.naturalHeight;
    setSteps(next);
    setCrop({ x: 0, y: 0, w: nextW, h: nextH });
    setSizeTouched(false);
    setWidth(nextW);
    setHeight(nextH);
  };

  const flip = (axis: "h" | "v") => {
    if (axis === "h") setFlipH((value) => !value);
    else setFlipV((value) => !value);
  };

  const resetEdits = () => {
    if (!img) return;
    setSteps(0);
    setFlipH(false);
    setFlipV(false);
    setCrop({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
    setWidth(img.naturalWidth);
    setHeight(img.naturalHeight);
    setSizeTouched(false);
    setBrightness(100);
    setContrast(100);
    setGrayscale(false);
    setZoom(1);
  };

  const zoomIn = () => setZoom((value) => Math.min(MAX_ZOOM, value * 1.25));

  const zoomOut = () => setZoom((value) => Math.max(MIN_ZOOM, value / 1.25));

  const onWidthChange = (value: string) => {
    const w = Number(value);
    if (!Number.isFinite(w) || w <= 0) return;
    setWidth(w);
    setSizeTouched(true);
    if (lockRatio) setHeight(Math.max(1, Math.round(w * cropAspect)));
  };

  const onHeightChange = (value: string) => {
    const h = Number(value);
    if (!Number.isFinite(h) || h <= 0) return;
    setHeight(h);
    setSizeTouched(true);
    if (lockRatio) setWidth(Math.max(1, Math.round(h / cropAspect)));
  };

  const exportImage = () => {
    const canvas = previewRef.current;
    if (!canvas || !img || !oriented) return;
    const sx = crop?.x ?? 0;
    const sy = crop?.y ?? 0;
    const outW = Math.max(1, Math.round(width || cropW));
    const outH = Math.max(1, Math.round(height || cropH));
    const output = document.createElement("canvas");
    output.width = outW;
    output.height = outH;
    const ctx = output.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, outW, outH);
    onInsert(output.toDataURL("image/png"), outW);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Insert image">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className={styles.hiddenInput}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {!img ? (
        <div
          className={styles.uploadZone}
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFile(event.dataTransfer.files?.[0]);
          }}
        >
          <Upload size={28} strokeWidth={1.6} aria-hidden="true" />
          <p>Choose an image from your computer</p>
          <span className={styles.uploadHint}>or drop it here</span>
          <Button variant="secondary" onClick={(event) => event.stopPropagation()}>
            <ImagePlus size={14} strokeWidth={1.8} aria-hidden="true" />
            Choose image file…
          </Button>
        </div>
      ) : (
        <div className={styles.editor}>
          <div ref={previewRowRef} className={styles.previewRow}>
            <div
              className={`${styles.previewWrap}${panning ? ` ${styles.previewPanning}` : ""}`}
              onPointerDown={startPan}
            >
              <div
                className={styles.previewInner}
                style={{ width: oriented!.w * viewScale, height: oriented!.h * viewScale }}
              >
                <canvas
                  ref={previewRef}
                  className={styles.previewCanvas}
                  style={{ width: oriented!.w * viewScale, height: oriented!.h * viewScale }}
                />
                {crop && (
                  <div
                    className={styles.cropBox}
                    style={{
                      left: crop.x * viewScale,
                      top: crop.y * viewScale,
                      width: crop.w * viewScale,
                      height: crop.h * viewScale,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => startCropDrag("move", event)}
                  >
                    <span className={`${styles.cropHandle} ${styles.cropNw}`} onMouseDown={(event) => startCropDrag("nw", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropNe}`} onMouseDown={(event) => startCropDrag("ne", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropSw}`} onMouseDown={(event) => startCropDrag("sw", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropSe}`} onMouseDown={(event) => startCropDrag("se", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropN}`} onMouseDown={(event) => startCropDrag("n", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropS}`} onMouseDown={(event) => startCropDrag("s", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropE}`} onMouseDown={(event) => startCropDrag("e", event)} />
                    <span className={`${styles.cropHandle} ${styles.cropW}`} onMouseDown={(event) => startCropDrag("w", event)} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.toolRow}>
            <button type="button" className={styles.iconButton} title="Rotate left" onClick={() => rotate(-1)}>
              <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className={styles.iconButton} title="Rotate right" onClick={() => rotate(1)}>
              <RotateCw size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className={styles.iconButton} title="Flip horizontally" onClick={() => flip("h")}>
              <FlipHorizontal size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className={styles.iconButton} title="Flip vertically" onClick={() => flip("v")}>
              <FlipVertical size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className={styles.toolSeparator} />
            <button type="button" className={styles.iconButton} title="Zoom out" onClick={zoomOut}>
              <ZoomOut size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
            <button type="button" className={styles.iconButton} title="Zoom in" onClick={zoomIn}>
              <ZoomIn size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className={styles.toolSeparator} />
            <button type="button" className={styles.iconButton} title="Reset edits" onClick={resetEdits}>
              <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <div className={styles.controls}>
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Crop</span>
              <span className={styles.controlHint}>
                <Crop size={12} strokeWidth={2} aria-hidden="true" /> Drag the frame on the image
              </span>
            </div>

            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Size</span>
              <div className={styles.sizeRow}>
                <label className={styles.sizeField}>
                  <span>Width</span>
                  <input
                    type="number"
                    min={1}
                    value={width || ""}
                    onChange={(event) => onWidthChange(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={styles.lockButton}
                  title={lockRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  aria-pressed={lockRatio}
                  onClick={() => setLockRatio((value) => !value)}
                >
                  {lockRatio ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
                </button>
                <label className={styles.sizeField}>
                  <span>Height</span>
                  <input
                    type="number"
                    min={1}
                    value={height || ""}
                    onChange={(event) => onHeightChange(event.target.value)}
                  />
                </label>
              </div>
              <span className={styles.controlHint}>Output size in pixels ({cropW} × {cropH} source)</span>
            </div>

            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Brightness</span>
              <input
                type="range"
                min={50}
                max={150}
                value={brightness}
                onChange={(event) => setBrightness(Number(event.target.value))}
              />
            </div>

            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Contrast</span>
              <input
                type="range"
                min={50}
                max={150}
                value={contrast}
                onChange={(event) => setContrast(Number(event.target.value))}
              />
            </div>

            <div className={styles.controlGroup}>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={grayscale}
                  onChange={(event) => setGrayscale(event.target.checked)}
                />
                Grayscale
              </label>
            </div>
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={exportImage}>
              Insert image
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
