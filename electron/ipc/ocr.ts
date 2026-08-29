import { ipcMain } from "electron";
import path from "node:path";
import Tesseract from "tesseract.js";
import { fetchWithLog } from "../httpLog.ts";
import type { FileStore } from "../store/FileStore.ts";

/** Lazily-created tesseract worker shared across OCR requests. */
let ocrWorker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;
let ocrWorkerLangs = "";

interface OcrIpcDeps {
  getStore: () => FileStore;
}

export function registerOcrIpc({ getStore }: OcrIpcDeps) {
  ipcMain.handle("ocr:get-info", async () => {
    const store = getStore();
    const files = store.readDir("ocr");
    const installed = files
      .filter((file) => /\.traineddata(\.gz)?$/.test(file))
      .map((file) => file.replace(/\.traineddata(\.gz)?$/, ""))
      .sort();
    return { dir: path.join(store.rootPath, "ocr"), installed };
  });

  ipcMain.handle(
    "ocr:download-model",
    async (
      event,
      lang: string,
    ): Promise<{ ok: boolean; lang: string; bytes?: number; error?: string }> => {
      const store = getStore();
      const url = (model: string) =>
        `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/${model}/${lang}.traineddata.gz`;
      const fileName = `${lang}.traineddata.gz`;
      try {
        // Prefer the higher-quality best_int models; fall back to the
        // standard 4.0.0 data for languages that don't ship them.
        let resp = await fetchWithLog(url("4.0.0_best_int"));
        if (!resp.ok) resp = await fetchWithLog(url("4.0.0"));
        if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
        const total = Number(resp.headers.get("content-length")) || 0;
        if (!resp.body) throw new Error("Response body is empty");
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          chunks.push(value);
          if (total > 0 && !event.sender.isDestroyed()) {
            event.sender.send("ocr:download-progress", { lang, received, total });
          }
        }
        // Combine all chunks into a single buffer
        const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        store.put("ocr", fileName, combined);
        return { ok: true, lang, bytes: received };
      } catch (err) {
        store.delete("ocr", fileName);
        return { ok: false, lang, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("ocr:delete-model", async (_event, lang: string) => {
    const store = getStore();
    const fileName = `${lang}.traineddata.gz`;
    const existed = store.exists("ocr", fileName);
    store.delete("ocr", fileName);
    return { ok: existed, lang };
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
      const store = getStore();
      const storeDir = path.join(store.rootPath, "ocr");
      for (const lang of langsKey.split("+")) {
        if (!store.exists("ocr", `${lang}.traineddata.gz`)) {
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
            langPath: storeDir,
            gzip: true,
            cacheMethod: "none",
            cachePath: storeDir,
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
