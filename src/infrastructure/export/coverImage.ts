/**
 * Cover-image fitting, shared by the paginated and the Word exporters.
 *
 * Chromium refuses data URLs over roughly 2 MB (`ERR_INVALID_URL`), so a
 * high-resolution cover — a photographed first page, say — has to be shrunk
 * before it can be embedded in the exported HTML. A `.docx` embeds bytes and
 * has no such limit, but it embeds the *same* picture, and a 40-megapixel scan
 * would make the file unusable, so both paths fit the cover once, here.
 */

const MAX_COVER_EMBED_BYTES = 1_000_000;
const COVER_EMBED_MAX_WIDTH = 1600;

export async function fitCoverForExport(dataUrl: string): Promise<string> {
  const match = /^data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes <= MAX_COVER_EMBED_BYTES) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, COVER_EMBED_MAX_WIDTH / bitmap.width);
      const width = Math.max(1, Math.floor(bitmap.width * scale));
      const height = Math.max(1, Math.floor(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      bitmap.close();
    }
  } catch {
    return dataUrl;
  }
}
