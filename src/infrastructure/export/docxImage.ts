import { ImageRun } from "docx";

/**
 * Image decoding shared by both DOCX writers.
 *
 * A Word file embeds picture bytes; it cannot point at a URL, a blob or a
 * custom protocol. Everything therefore has to be resolved to real bytes in
 * the renderer before the writer runs, and only in the formats Word accepts:
 * `docx` takes PNG, JPEG, GIF and BMP, so a WebP — which is what the browser
 * produces for a screenshot or a scan — has to be re-encoded on the way in.
 * Without that, the image is silently dropped from the file.
 */

export type ImageKind = "png" | "jpg" | "gif" | "bmp";

export interface DecodedImage {
  kind: ImageKind;
  data: Uint8Array;
}

const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|bmp|webp);base64,(.+)$/i;

const WEBP_PREFIX = "data:image/webp";

function kindOf(name: string): ImageKind | null {
  const lower = name.toLowerCase();
  if (lower === "png") return "png";
  if (lower === "jpg" || lower === "jpeg") return "jpg";
  if (lower === "gif") return "gif";
  if (lower === "bmp") return "bmp";
  return null;
}

/** Bytes behind a `data:` image URL, or `null` for anything else (a remote
 *  URL, a blob, a `readlynx-translation-image://` link that could not be
 *  resolved). WebP is rejected here and handled by `pngFromWebp`. */
export function decodeImage(src: string): DecodedImage | null {
  const match = DATA_IMAGE_RE.exec(src);
  if (!match) return null;
  const kind = kindOf(match[1]);
  if (!kind) return null;
  try {
    const binary = atob(match[2]);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    return { kind, data };
  } catch {
    return null;
  }
}

function readPng(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null;
  const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
  const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
  return width > 0 && height > 0 ? { width, height } : null;
}

function readGif(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 10) return null;
  const width = data[6] | (data[7] << 8);
  const height = data[8] | (data[9] << 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readBmp(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 26) return null;
  const width = data[18] | (data[19] << 8) | (data[20] << 16) | (data[21] << 24);
  const height = data[22] | (data[23] << 8) | (data[24] << 16) | (data[25] << 24);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpeg(data: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    const length = (data[i + 2] << 8) + data[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && length >= 7 && i + 8 < data.length) {
      const height = (data[i + 5] << 8) + data[i + 6];
      const width = (data[i + 7] << 8) + data[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    i += 2 + length;
  }
  return null;
}

/** Intrinsic size of an already-decoded image, read from its header so the
 *  picture keeps the proportions the author placed it with. */
export function imageAspectRatio(
  image: DecodedImage,
): { width: number; height: number } | null {
  if (image.kind === "png") return readPng(image.data);
  if (image.kind === "gif") return readGif(image.data);
  if (image.kind === "bmp") return readBmp(image.data);
  return readJpeg(image.data);
}

/** Re-encodes a WebP data URL as PNG, because Word cannot read WebP. */
export async function pngFromWebp(src: string): Promise<string | null> {
  if (!src.startsWith(WEBP_PREFIX)) return src;
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Rewrites every WebP `img` in a parsed body to PNG, in place. A picture
 *  that will not convert is left alone, and the writer then drops it rather
 *  than emitting a Word file with a broken reference. */
export async function inlineWebpImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll("img")).filter((img) =>
    img.getAttribute("src")?.startsWith(WEBP_PREFIX),
  );
  await Promise.all(
    images.map(async (img) => {
      const source = img.getAttribute("src");
      if (!source) return;
      const png = await pngFromWebp(source);
      if (png) img.setAttribute("src", png);
    }),
  );
}

export interface ImageRunOptions {
  /** Widest the picture may be, in points. */
  maxWidthPt: number;
  /** Widest the picture may be, in points, when it is taller than it is wide. */
  maxHeightPt?: number;
  alt?: string;
}

/** Fits an image inside the content box without distorting it. */
export function fitImage(
  image: DecodedImage,
  { maxWidthPt, maxHeightPt }: { maxWidthPt: number; maxHeightPt?: number },
): { width: number; height: number } {
  const size = imageAspectRatio(image);
  // A picture whose header cannot be read falls back to a 3:2 frame rather
  // than to a square, which is what the writer used to assume for everything.
  const aspect = size ? size.width / size.height : 1.5;
  const heightCap = maxHeightPt ?? Number.POSITIVE_INFINITY;
  let width = maxWidthPt;
  let height = maxWidthPt / aspect;
  if (height > heightCap) {
    height = heightCap;
    width = heightCap * aspect;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** A `docx` image run, or `null` when the bytes are not something Word can
 *  embed. */
export function imageRun(image: DecodedImage, options: ImageRunOptions): ImageRun | null {
  try {
    const transformation = fitImage(image, options);
    const alt = options.alt?.trim();
    return new ImageRun({
      type: image.kind,
      data: image.data,
      ...(alt ? { altText: { name: alt, description: alt, title: alt } } : {}),
      transformation,
    });
  } catch {
    return null;
  }
}

/** `src` attribute -> `ImageRun`, for markup that has already been through
 *  `inlineWebpImages`. */
export function imageRunFromSrc(
  src: string,
  options: ImageRunOptions,
): ImageRun | null {
  const decoded = decodeImage(src);
  return decoded ? imageRun(decoded, options) : null;
}
