import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import Tesseract from "tesseract.js";
import { fetchWithLog } from "../httpLog.ts";

const tessdataDir = (): string => path.join(app.getPath("userData"), "tessdata");

/** Lazily-created tesseract worker shared across OCR requests. */
let ocrWorker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;
let ocrWorkerLangs = "";

export function registerOcrIpc() {
  ipcMain.handle("ocr:get-info", async () => {
    const dir = tessdataDir();
    await fs.promises.mkdir(dir, { recursive: true });
    let files: string[] = [];
    try {
      files = await fs.promises.readdir(dir);
    } catch {
      // treat an unreadable directory as `no models installed`
    }
    const installed = files
      .filter((file) => /\.traineddata(\.gz)?$/.test(file))
      .map((file) => file.replace(/\.traineddata(\.gz)?$/, ""))
      .sort();
    return { dir, installed };
  });

  ipcMain.handle(
    "ocr:download-model",
    async (
      event,
      lang: string,
    ): Promise<{ ok: boolean; lang: string; bytes?: number; error?: string }> => {
      const dir = tessdataDir();
      await fs.promises.mkdir(dir, { recursive: true });
      const url = (model: string) =>
        `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/${model}/${lang}.traineddata.gz`;
      const dest = path.join(dir, `${lang}.traineddata.gz`);
      try {
        // Prefer the higher-quality best_int models; fall back to the
        // standard 4.0.0 data for languages that don't ship them.
        let resp = await fetchWithLog(url("4.0.0_best_int"));
        if (!resp.ok) resp = await fetchWithLog(url("4.0.0"));
        if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
        const total = Number(resp.headers.get("content-length")) || 0;
        if (!resp.body) throw new Error("Response body is empty");
        const reader = resp.body.getReader();
        const out = await fs.promises.open(dest, "w");
        let received = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            await out.write(value);
            if (total > 0 && !event.sender.isDestroyed()) {
              event.sender.send("ocr:download-progress", { lang, received, total });
            }
          }
        } finally {
          await out.close();
        }
        return { ok: true, lang, bytes: received };
      } catch (err) {
        await fs.promises.unlink(dest).catch(() => undefined);
        return { ok: false, lang, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("ocr:delete-model", async (_event, lang: string) => {
    const dest = path.join(tessdataDir(), `${lang}.traineddata.gz`);
    try {
      await fs.promises.unlink(dest);
      return { ok: true, lang };
    } catch {
      return { ok: false, lang };
    }
  });

  ipcMain.handle(
    "ocr:recognize",
    async (
      event,
      payload: { dataUrl: string; langs: string[] },
    ): Promise<{ text?: string; error?: string }> => {
      const { dataUrl, langs } = payload;
      const langsKey = Array.from(new Set(langs.filter(Boolean))).join("+");
      if (!langsKey) return { error: "Select at least one language." };
      const dir = tessdataDir();
      await fs.promises.mkdir(dir, { recursive: true });
      for (const lang of langsKey.split("+")) {
        const exists = await fs.promises
          .access(path.join(dir, `${lang}.traineddata.gz`))
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          return { error: `The "${lang}" model is not downloaded yet. Download it from the OCR panel first.` };
        }
      }
      const sendProgress = (progress: number) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("ocr:recognize-progress", { progress });
        }
      };
      try {
        sendProgress(0);
        if (!ocrWorker) {
          ocrWorker = await Tesseract.createWorker(langsKey, Tesseract.OEM.LSTM_ONLY, {
            langPath: dir,
            gzip: true,
            cacheMethod: "none",
            cachePath: dir,
            logger: (message) => {
              if (message.status === "recognizing text") sendProgress(message.progress);
            },
          });
          ocrWorkerLangs = langsKey;
        } else if (ocrWorkerLangs !== langsKey) {
          await ocrWorker.reinitialize(langsKey, Tesseract.OEM.LSTM_ONLY);
          ocrWorkerLangs = langsKey;
        }
        const { data } = await ocrWorker.recognize(dataUrl);
        sendProgress(1);
        return { text: data.text };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}

/** Terminates the shared worker; called on app quit. */
export async function terminateOcrWorker(): Promise<void> {
  await ocrWorker?.terminate();
  ocrWorker = null;
  ocrWorkerLangs = "";
}
