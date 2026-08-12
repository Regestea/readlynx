import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AiModel } from "../../../infrastructure/db/entities/AiModel.ts";
import type { BookSourceType } from "../../../infrastructure/db/entities/types.ts";
import type { PdfViewerHandle } from "../../../components/pdfViewer/PdfViewer.tsx";
import type { EpubViewerHandle } from "../../../components/epubViewer/EpubViewer.tsx";
import { replaceImageTokens } from "../../../shared/document/epubToMarkdown.ts";
import { getDefaultAiModel, resolveProviderBaseUrl } from "../../../infrastructure/ai/modelResolver";
import { chunkChapter } from "./epubChunker.ts";
import { buildTranslationSystemPrompt, buildTranslationUserPrompt } from "./prompt.ts";
import {
  DEFAULT_TRANSLATION_SETTINGS,
  docTypeFor,
  methodFor,
  unitToChapter,
  unitToPage,
} from "./types.ts";
import type {
  TranslationMethod,
  TranslationSettings,
  TranslationUnitKey,
  TranslationViewMode,
} from "./types.ts";

interface UseTranslationOptions {
  bookId: string;
  sourceType: BookSourceType;
  pdfRef: RefObject<PdfViewerHandle | null>;
  epubRef: RefObject<EpubViewerHandle | null>;
}

/** Chunk keys are ordered by their index, zero-padded so string ordering
 *  matches chunk order (`…#0009` < `…#0010`). */
function chunkKeyFor(chapterKey: string, index: number): string {
  return `${chapterKey}#${String(index).padStart(4, "0")}`;
}

/**
 * Orchestrates reading-mode translation: cached per-page / per-chapter
 * results, OCR + AI pipelines, settings persistence and the view toggle.
 * It stays independent of the viewers — it only talks to them through the
 * handles exposed by `PdfViewer` / `EpubViewer`.
 */
export function useTranslation({ bookId, sourceType, pdfRef, epubRef }: UseTranslationOptions) {
  const [viewMode, setViewModeState] = useState<TranslationViewMode>("original");
  const [pdfMethod, setPdfMethod] = useState<TranslationMethod>("ocr");
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_TRANSLATION_SETTINGS);
  const [unitKey, setUnitKey] = useState<TranslationUnitKey | null>(null);

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasTranslation, setHasTranslation] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);

  const [model, setModel] = useState<AiModel | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [installed, setInstalled] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const busyRef = useRef(false);
  const hasTranslationRef = useRef(false);
  const unitKeyRef = useRef<TranslationUnitKey | null>(null);
  const settingsRef = useRef(settings);
  const modelRef = useRef(model);
  const pdfMethodRef = useRef(pdfMethod);
  const downloadingRef = useRef<string | null>(null);
  const autoTriedRef = useRef<string | null>(null);
  const savedRef = useRef(false);
  const positionRef = useRef({ currentPage: 1, scrollPosition: 0 });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    pdfMethodRef.current = pdfMethod;
  }, [pdfMethod]);

  useEffect(() => {
    hasTranslationRef.current = hasTranslation;
  }, [hasTranslation]);

  useEffect(() => {
    unitKeyRef.current = unitKey;
  }, [unitKey]);

  /** Loads the per-book reading settings and the default AI model. */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const db = window.readlynx?.db;
      if (!db) return;
      try {
        const [state, models] = await Promise.all([
          db.getReadingState(bookId),
          db.listAiModels(),
        ]);
        if (cancelled) return;
        if (state) {
          positionRef.current = { currentPage: state.currentPage, scrollPosition: state.scrollPosition };
          setSettings({
            ocrLangs: state.ocrLangs.length ? state.ocrLangs : DEFAULT_TRANSLATION_SETTINGS.ocrLangs,
            sourceLang: state.sourceLang || DEFAULT_TRANSLATION_SETTINGS.sourceLang,
            targetLang: state.targetLang || DEFAULT_TRANSLATION_SETTINGS.targetLang,
            customPrompt: state.customPrompt ?? "",
          });
        }
        const defaultModel = getDefaultAiModel(models);
        setModel(defaultModel);
        if (!defaultModel) {
          setModelsError("No AI model configured. Add one in Settings → AI Models.");
        }
      } catch {
        // keep defaults
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  /** Persists settings changes back into the book's `ReadingState` row. */
  useEffect(() => {
    if (!savedRef.current) {
      savedRef.current = true;
      return;
    }
    void window.readlynx?.db.updateReadingState(bookId, { ...positionRef.current, ...settings });
  }, [bookId, settings]);

  /** Resets per-unit state whenever the unit or pipeline changes. Done
   *  during render (React's recommended pattern) so no stale labels flash
   *  before the refresh effect below completes. */
  const [pipelineKey, setPipelineKey] = useState("");
  const pipeline = `${bookId}|${unitKey ?? ""}|${sourceType}|${pdfMethod}`;
  if (pipelineKey !== pipeline) {
    setPipelineKey(pipeline);
    setMarkdown(null);
    setHasTranslation(false);
    setCacheReady(false);
    setError(null);
    setStatus(null);
  }

  /** Refresh the cached translation whenever the unit (PDF page / EPUB
   *  chapter) or the chosen pipeline changes. */
  useEffect(() => {
    if (!unitKey) return;
    let cancelled = false;
    const method = methodFor(sourceType, pdfMethodRef.current);
    const db = window.readlynx?.db;
    if (!db) return;
    const refresh = async () => {
      try {
        const page = unitToPage(unitKey);
        const chapter = unitToChapter(unitKey);
        const rows = await db.getTranslations(
          sourceType === "epub"
            ? { bookId, method: "chapter", chunkKeyPrefix: chapter ?? undefined }
            : { bookId, method, pageNumber: page ?? undefined },
        );
        if (cancelled) return;
        if (rows.length === 0) {
          setMarkdown(null);
          setHasTranslation(false);
        } else {
          const raw =
            sourceType === "epub"
              ? rows.map((row) => row.markdown).join("\n\n")
              : rows[0].markdown;
          const text =
            sourceType === "epub"
              ? replaceImageTokens(
                  raw,
                  epubRef.current?.getCurrentChapterExtraction()?.images ?? [],
                )
              : raw;
          setMarkdown(text);
          setHasTranslation(true);
        }
        setCacheReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setCacheReady(true);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [unitKey, bookId, sourceType, pdfMethod, epubRef]);

  const setViewMode = useCallback((mode: TranslationViewMode) => {
    setViewModeState(mode);
  }, []);

  const updateSettings = useCallback((patch: Partial<TranslationSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  /** Loads cached rows for a unit and exposes them (used by the panel). */
  const refreshModels = useCallback(async () => {
    const info = await window.readlynx?.ocr.getInfo();
    if (info) setInstalled(info.installed);
  }, []);

  const downloadModel = useCallback(async (lang: string) => {
    if (downloadingRef.current) return;
    downloadingRef.current = lang;
    setDownloading(lang);
    setDownloadProgress(0);
    setStatus(`Downloading ${lang} model…`);
    try {
      const result = await window.readlynx?.ocr.downloadModel(lang);
      if (!result || !result.ok) {
        throw new Error(result?.error ?? `Could not download the ${lang} model.`);
      }
      setStatus(`"${lang}" model installed.`);
      await refreshModels();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      downloadingRef.current = null;
      setDownloading(null);
      setDownloadProgress(null);
    }
  }, [refreshModels]);

  const deleteModel = useCallback(async (lang: string) => {
    await window.readlynx?.ocr.deleteModel(lang);
    await refreshModels();
    setStatus(`"${lang}" model removed.`);
  }, [refreshModels]);

  /** Live OCR progress while a page is being recognized. */
  useEffect(() => {
    if (!(busy && sourceType === "pdf" && pdfMethod === "ocr")) return;
    const unsubscribe =
      window.readlynx?.ocr.onRecognizeProgress(({ progress }) => {
        setStatus(`Recognizing page… ${Math.round(progress * 100)}%`);
      });
    return () => unsubscribe?.();
  }, [busy, sourceType, pdfMethod]);

  /** Download progress while an OCR model is being fetched. */
  useEffect(() => {
    const unsubscribe =
      window.readlynx?.ocr.onDownloadProgress(({ lang, received, total }) => {
        if (downloadingRef.current !== lang) return;
        const ratio = total > 0 ? received / total : 0;
        setDownloadProgress(ratio);
        setStatus(`Downloading ${lang} model… ${Math.round(ratio * 100)}%`);
      });
    return () => unsubscribe?.();
  }, []);

  const saveRow = useCallback(
    async (translation: {
      method: TranslationMethod;
      pageNumber: number | null;
      chunkKey: string | null;
      markdown: string;
    }) => {
      const current = settingsRef.current;
      await window.readlynx?.db.putTranslation({
        id: crypto.randomUUID(),
        bookId,
        sourceType,
        method: translation.method,
        pageNumber: translation.pageNumber,
        chunkKey: translation.chunkKey,
        sourceLang: current.sourceLang,
        targetLang: current.targetLang,
        customPrompt: current.customPrompt,
        markdown: translation.markdown,
        updatedAt: "",
      });
    },
    [bookId, sourceType],
  );

  /** Translates the current unit. With `force`, regeneration bypasses the
   *  cache and overwrites the stored rows. */
  const translate = useCallback(async (force = false) => {
    const db = window.readlynx?.db;
    const ai = window.readlynx?.ai;
    if (!db || !ai) {
      setError("The AI bridge is not available.");
      return;
    }
    if (busyRef.current) return;
    const key = unitKeyRef.current;
    if (!key) {
      setError("Nothing to translate yet — open the book first.");
      return;
    }
    if (!force && hasTranslationRef.current) return;

    const currentModel = modelRef.current;
    if (!currentModel?.APIKey || !currentModel.ModelName) {
      setError("No AI model configured. Add one in Settings → AI Models.");
      return;
    }
    let url: string;
    try {
      url = resolveProviderBaseUrl(currentModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The model has no URL configured.");
      return;
    }

    const currentSettings = settingsRef.current;
    const method = methodFor(sourceType, pdfMethodRef.current);
    const docType = docTypeFor(sourceType, pdfMethodRef.current);
    const input = { url, apiKey: currentModel.APIKey, modelName: currentModel.ModelName };
    const promptContext = {
      docType,
      sourceLang: currentSettings.sourceLang,
      ocrLangs: currentSettings.ocrLangs,
      targetLang: currentSettings.targetLang,
      customPrompt: currentSettings.customPrompt,
    };
    const systemPrompt = buildTranslationSystemPrompt(promptContext);

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      let result: string;
      if (method === "chapter") {
        const extraction = epubRef.current?.getCurrentChapterExtraction();
        if (!extraction || !extraction.text) {
          throw new Error("The chapter text is not available yet.");
        }
        const chunks = chunkChapter(extraction.text);
        if (chunks.length === 0) {
          throw new Error("The chapter has no text to translate.");
        }
        const chapterKey = unitToChapter(key) ?? "chapter";
        // Regenerate replaces the whole chapter: drop every cached chunk of
        // this chapter (incl. stale chunks from earlier, differently-chunked
        // generations) before the fresh chunks are written.
        if (force) {
          await db.deleteTranslations({ bookId, method: "chapter", chunkKeyPrefix: chapterKey });
        }
        const results: string[] = [];
        for (let index = 0; index < chunks.length; index += 1) {
          setStatus(
            chunks.length === 1
              ? "Translating chapter…"
              : `Translating chunk ${index + 1} of ${chunks.length}…`,
          );
          const response = await ai.chat({
            input,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: buildTranslationUserPrompt(promptContext, chunks[index]) },
            ],
          });
          const chunk = response.trim();
          if (!chunk) throw new Error("The AI returned an empty translation.");
          await saveRow({ method, pageNumber: null, chunkKey: chunkKeyFor(chapterKey, index), markdown: chunk });
          results.push(chunk);
        }
        result = replaceImageTokens(results.join("\n\n"), extraction.images);
      } else {
        const image = pdfRef.current?.getCurrentPageImage();
        if (!image) {
          throw new Error("The page image is not ready yet.");
        }
        const page = unitToPage(key) ?? 1;
        // Regenerate replaces the whole page translation: remove the previous
        // row (page rows share `chunkKey IS NULL`, so upserts could otherwise
        // leave duplicates) before the fresh result is saved.
        if (force) {
          await db.deleteTranslations({ bookId, method, pageNumber: page });
        }
        if (method === "ocr") {
          setStatus("Recognizing page…");
          const ocrResult = await window.readlynx?.ocr.recognize({
            dataUrl: image,
            langs: currentSettings.ocrLangs,
          });
          if (!ocrResult) throw new Error("OCR is unavailable.");
          if (ocrResult.error) throw new Error(ocrResult.error);
          const text = (ocrResult.text ?? "").trim();
          if (!text) throw new Error("No text detected on this page.");
          setStatus("Translating page…");
          const response = await ai.chat({
            input,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: buildTranslationUserPrompt(promptContext, text) },
            ],
          });
          result = response.trim();
        } else {
          setStatus("Translating page with AI vision…");
          const response = await ai.chat({
            input,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: buildTranslationUserPrompt(promptContext, "") },
            ],
            images: [image],
          });
          result = response.trim();
        }
        if (!result) throw new Error("The AI returned an empty translation.");
        await saveRow({ method, pageNumber: page, chunkKey: null, markdown: result });
      }
      setMarkdown(result);
      setHasTranslation(true);
      setStatus(null);
      // The user asked for the translation — take them to it once it's done
      // (no-op when the translation view is already showing).
      setViewModeState("translation");
    } catch (err) {
      // Previous translations are kept untouched — rows are only written
      // after a successful generation.
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [epubRef, pdfRef, saveRow, sourceType, bookId]);

  const regenerate = useCallback(() => {
    void translate(true);
  }, [translate]);

  /** Auto-starts translation when the user enters translation view and the
   *  current unit has no cached result yet. */
  useEffect(() => {
    if (viewMode !== "translation") return;
    if (!unitKey || busy || !cacheReady || hasTranslation || error) return;
    if (autoTriedRef.current === unitKey) return;
    autoTriedRef.current = unitKey;
    void translate(false);
    // Intentionally re-checked whenever these inputs change; the
    // `autoTriedRef` guard keeps it from re-running per unit.
  }, [viewMode, unitKey, busy, cacheReady, hasTranslation, error, translate]);

  return {
    viewMode,
    setViewMode,
    pdfMethod,
    setPdfMethod,
    settings,
    updateSettings,
    setUnit: setUnitKey,
    markdown,
    busy,
    status,
    error,
    hasTranslation,
    model,
    modelsError,
    installed,
    downloading,
    downloadProgress,
    downloadModel,
    deleteModel,
    refreshModels,
    translate,
    regenerate,
  };
}