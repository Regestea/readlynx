import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AiModel } from "../../../infrastructure/db/entities";
import type { BookSourceType } from "../../../infrastructure/db/entities";
import type { PdfViewerHandle } from "../../../components/pdfViewer/PdfViewer.tsx";
import type { EpubViewerHandle } from "../../../components/epubViewer/EpubViewer.tsx";
import {
  normalizeTranslatedMarkdown,
  replaceImageTokens,
  extractDataUrlFromImageRef,
  replaceImageTokensWithProtocolUrls,
} from "../../../shared/document/epubToMarkdown.ts";
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
  /** True once the EPUB viewer has finished loading and its chapter DOM is
   *  available for image extraction. Irrelevant for PDF books. */
  epubReady: boolean;
}

/** Chunk keys are ordered by their index, zero-padded so string ordering
 *  matches chunk order (`…#0009` < `…#0010`). */
function chunkKeyFor(chapterKey: string, index: number): string {
  return `${chapterKey}#${String(index).padStart(4, "0")}`;
}

/** Thrown inside the pipeline when the user cancels a running translation;
 *  caught by the callers and surfaced as a status message, not an error. */
class TranslationCancelledError extends Error {}

/**
 * Orchestrates reading-mode translation: cached per-page / per-chapter
 * results, OCR + AI pipelines, settings persistence and the view toggle.
 * It stays independent of the viewers — it only talks to them through the
 * handles exposed by `PdfViewer` / `EpubViewer`.
 */
export function useTranslation({ bookId, sourceType, pdfRef, epubRef, epubReady }: UseTranslationOptions) {
  const [viewMode, setViewModeState] = useState<TranslationViewMode>("original");
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_TRANSLATION_SETTINGS);
  const [unitKey, setUnitKey] = useState<TranslationUnitKey | null>(null);

  const [markdown, setMarkdown] = useState<string | null>(null);
  /** Which unit the currently displayed `markdown` belongs to (null while
   *  the content shown is stale — the previous unit's text kept on screen
   *  during a switch so the viewer never unmounts and fullscreen survives). */
  const [markdownUnitKey, setMarkdownUnitKey] = useState<TranslationUnitKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasTranslation, setHasTranslation] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);
  /** Bumped after a range translation finishes so the on-screen unit
   *  re-reads its (possibly newly written) cached rows. */
  const [refreshTick, setRefreshTick] = useState(0);
  /** Progress of a running page-range translation (null while idle). */
  const [rangeProgress, setRangeProgress] = useState<{ done: number; total: number } | null>(null);
  /** Rate-limit retry attempt counter (null when not retrying). */
  const [rateLimitRetry, setRateLimitRetry] = useState<number | null>(null);
  /** True while waiting for the EPUB viewer to finish loading so cached
   *  translation image tokens can be resolved into real image URLs. */
  const [imagesPending, setImagesPending] = useState(false);
  /** Raw cached markdown (with [IMG-n] tokens) stored while the EPUB viewer
   *  finishes loading; resolved into real images once the DOM is available. */
  const rawCachedMarkdownRef = useRef<string | null>(null);

  const [models, setModels] = useState<AiModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [installed, setInstalled] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const busyRef = useRef(false);
  /** Tracks which unit key is currently being translated by `translate`.
   *  Allows the old chapter's translation to continue in the background
   *  while a new chapter starts its own translation independently. */
  const busyUnitRef = useRef<TranslationUnitKey | null>(null);
  /** Set by the toolbar's Cancel button; checked at every pipeline
   *  checkpoint so a running translation stops at the next safe point. */
  const cancelRequestedRef = useRef(false);
  const hasTranslationRef = useRef(false);
  const unitKeyRef = useRef<TranslationUnitKey | null>(null);
  const settingsRef = useRef(settings);
  const modelsRef = useRef(models);
  const downloadingRef = useRef<string | null>(null);
  const autoTriedRef = useRef<string | null>(null);
  const savedRef = useRef(false);
  const customPromptRef = useRef("");
  /** Base status text without retry suffix — used to append retry info. */
  const baseStatusRef = useRef<string | null>(null);
  /** Text of the currently chosen instruction, resolved from the
   *  `CustomInstructions` table and paired with the id it was fetched for so
   *  the effective prompt is derived synchronously during render (empty while
   *  the id is new or the fetch is pending). */
  const [resolvedPrompt, setResolvedPrompt] = useState<{ id: string; content: string }>({
    id: "",
    content: "",
  });
  const customPrompt =
    settings.customPromptId === resolvedPrompt.id ? resolvedPrompt.content : "";

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  useEffect(() => {
    customPromptRef.current = customPrompt;
  }, [customPrompt]);

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
        const [state, modelRows] = await Promise.all([
          db.getReadingState(bookId),
          db.listAiModels(),
        ]);
        if (cancelled) return;
        setModels(modelRows);
        if (state) {
          // Ordered model list: prefer `modelIds` (failover order), fall
          // back to the legacy single-choice `modelId` column. Ids whose
          // model was deleted are dropped here — and the cleanup is
          // persisted through the settings effect — so the book never
          // keeps dangling references.
          const rawIds = state.modelIds?.length
            ? state.modelIds
            : state.modelId
              ? [state.modelId]
              : [];
          const validIds = rawIds.filter((id) => modelRows.some((row) => row.Id === id));
          setSettings({
            ocrLangs: state.ocrLangs.length ? state.ocrLangs : DEFAULT_TRANSLATION_SETTINGS.ocrLangs,
            targetLang: state.targetLang || DEFAULT_TRANSLATION_SETTINGS.targetLang,
            modelIds: validIds,
            customPromptId: state.customPromptId ?? "",
            pdfMethod: state.pdfMethod === "vision" ? "vision" : "ocr",
          });
        }
        if (modelRows.length === 0) {
          setModelsError("No AI model configured. Add one in Settings → AI Models.");
        }
        const ocrInfo = await window.readlynx?.ocr.getInfo();
        if (!cancelled && ocrInfo) setInstalled(ocrInfo.installed);
      } catch {
        // keep defaults
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  /** Resolves the chosen instruction's text from the `CustomInstructions`
   *  table (the source of truth — the prompt is no longer stored on the
   *  book's reading state). */
  useEffect(() => {
    if (!settings.customPromptId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.readlynx?.db.listCustomInstructions();
        if (cancelled) return;
        const found = rows?.find((row) => row.id === settings.customPromptId);
        setResolvedPrompt({ id: settings.customPromptId, content: found?.content ?? "" });
      } catch {
        // keep the previous prompt
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [settings.customPromptId]);

  /** Re-resolves the instruction text after the instruction manager edits
   *  the currently selected instruction (its id does not change, so the
   *  effect above would not re-run). */
  const refreshCustomPrompt = useCallback(() => {
    const id = settingsRef.current.customPromptId;
    if (!id) return;
    void window.readlynx?.db
      .listCustomInstructions()
      .then((rows) => {
        const found = rows?.find((row) => row.id === id);
        setResolvedPrompt({ id, content: found?.content ?? "" });
      })
      .catch(() => {
        // keep the previous prompt
      });
  }, []);

  /** Persists settings changes back into the book's `ReadingState` row.
   *  Position changes (page / chapter) are written by the reading page
   *  itself; the partial upsert leaves them untouched. */
  useEffect(() => {
    if (!savedRef.current) {
      savedRef.current = true;
      return;
    }
    void window.readlynx?.db.updateReadingState(bookId, settings);
  }, [bookId, settings]);

  /** Resets per-unit state whenever the unit changes. Done during render
   *  (React's recommended pattern) so no stale labels flash before the
   *  refresh effect below completes. The pipeline (OCR / AI vision) is
   *  deliberately left out of the key: a unit has one translation,
   *  regardless of how it was produced. */
  const [pipelineKey, setPipelineKey] = useState("");
  const pipeline = `${bookId}|${unitKey ?? ""}|${sourceType}`;
  if (pipelineKey !== pipeline) {
    setPipelineKey(pipeline);
    // The previous unit's markdown is deliberately kept on screen (only
    // marked stale) so the Markdown component never unmounts mid-switch —
    // remounting would flash the whole view and drop its fullscreen state.
    setMarkdownUnitKey(null);
    setHasTranslation(false);
    setCacheReady(false);
    setError(null);
    setStatus(null);
  }

  /** Allow auto-translate to fire for the new unit even if the previous
   *  unit's translate was still in flight when the user navigated away. */
  useEffect(() => {
    autoTriedRef.current = null;
  }, [unitKey]);

  /** Refresh the cached translation whenever the unit (PDF page / EPUB
   *  chapter) changes. The lookup is method-agnostic — one translation per
   *  page / chapter, whatever pipeline produced it. */
  useEffect(() => {
    if (!unitKey) return;
    let cancelled = false;
    const db = window.readlynx?.db;
    if (!db) return;
    const refresh = async () => {
      try {
        const page = unitToPage(unitKey);
        const chapter = unitToChapter(unitKey);
        const rows = await db.getTranslations(
          sourceType === "epub"
            ? { bookId, chunkKeyPrefix: chapter ?? undefined }
            : { bookId, pageNumber: page ?? undefined },
        );
        if (cancelled) return;
        if (rows.length === 0) {
          setMarkdown(null);
          setMarkdownUnitKey(unitKey);
          setHasTranslation(false);
          setImagesPending(false);
          rawCachedMarkdownRef.current = null;
        } else {
          const rawJoined =
            sourceType === "epub"
              ? rows.map((row) => row.markdown).join("\n\n")
              : rows[0].markdown;
          // Normalize old cached rows that may have stored long code as inline
          // (from before the fix) so they display correctly without re-translation.
          const raw = normalizeTranslatedMarkdown(rawJoined);
          if (sourceType === "epub") {
            const hasProtocolUrls = raw.includes("readlynx-translation-image://");
            const needsImages = !hasProtocolUrls && raw.includes("[IMG-");
            if (!needsImages) {
              // Image-less chapter or already has persisted protocol URLs.
              setMarkdown(raw);
              setMarkdownUnitKey(unitKey);
              setHasTranslation(true);
              setImagesPending(false);
              rawCachedMarkdownRef.current = null;
            } else {
              const images = epubRef.current?.getCurrentChapterExtraction()?.images;
              const tokenCount = (raw.match(/\[IMG-\d+\]/g) || []).length;
              const hasEnoughImages = !!images && images.length >= tokenCount && tokenCount > 0;
              if (hasEnoughImages) {
                setMarkdown(replaceImageTokens(raw, images));
                setMarkdownUnitKey(unitKey);
                setHasTranslation(true);
                setImagesPending(false);
                rawCachedMarkdownRef.current = null;
              } else {
                // Needs images but the viewer hasn't extracted them yet
                // (initial load or a fast chapter switch). Keep the previous
                // markdown on screen with a loading veil instead of clearing
                // to null — clearing would flash "No translation yet" even
                // though the cache exists (race seen after the
                // display:none → visibility fix).
                rawCachedMarkdownRef.current = raw;
                setImagesPending(true);
                setHasTranslation(true);
                // Don't update markdown / markdownUnitKey yet — keep the
                // stale markdown visible with `markdownLoading` veil until
                // the viewer provides the correct images.
              }
            }
          } else {
            setMarkdown(raw);
            setMarkdownUnitKey(unitKey);
            setHasTranslation(true);
            setImagesPending(false);
            rawCachedMarkdownRef.current = null;
          }
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
  }, [unitKey, bookId, sourceType, epubRef, refreshTick]);

  /** Resolves image tokens in a cached translation once the EPUB viewer
   *  finishes loading. The cache-loading effect stores the raw markdown
   *  (with [IMG-n] tokens) in `rawCachedMarkdownRef` when the chapter DOM
   *  is not yet available; this effect picks it up once `epubReady` flips
   *  or when a fast navigation left the viewer one frame behind. */
  useEffect(() => {
    if (!imagesPending) return;
    const raw = rawCachedMarkdownRef.current;
    if (!raw) return;
    const needsImages = raw.includes("[IMG-");
    if (!needsImages) {
      const key = unitKeyRef.current;
      rawCachedMarkdownRef.current = null;
      if (key) {
        setMarkdown(raw);
        setMarkdownUnitKey(key);
      } else {
        setMarkdown(raw);
      }
      setImagesPending(false);
      return;
    }
    if (!epubReady) return;
    let cancelled = false;
    let timer: number | undefined;
    const tryResolve = () => {
      if (cancelled) return;
      const currentRaw = rawCachedMarkdownRef.current;
      if (!currentRaw) return;
      const images = epubRef.current?.getCurrentChapterExtraction()?.images;
      if (!images || images.length === 0) {
        timer = window.setTimeout(tryResolve, 150);
        return;
      }
      const tokenCount = (currentRaw.match(/\[IMG-\d+\]/g) || []).length;
      if (images.length < tokenCount) {
        timer = window.setTimeout(tryResolve, 150);
        return;
      }
      const key = unitKeyRef.current;
      rawCachedMarkdownRef.current = null;
      if (key) {
        setMarkdown(replaceImageTokens(currentRaw, images));
        setMarkdownUnitKey(key);
      } else {
        setMarkdown(replaceImageTokens(currentRaw, images));
      }
      setImagesPending(false);
    };
    tryResolve();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [epubReady, imagesPending, epubRef, unitKey]);

  const setViewMode = useCallback((mode: TranslationViewMode) => {
    setViewModeState(mode);
  }, []);

  const updateSettings = useCallback((patch: Partial<TranslationSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  /** The ordered list of models a translation request runs against, read at
   *  call time: the user's pick first, then the app default as the only
   *  fallback when nothing is selected. */
  const orderedModelCandidates = useCallback((): AiModel[] => {
    const rows = modelsRef.current;
    const picked: AiModel[] = [];
    for (const id of settingsRef.current.modelIds) {
      const found = rows.find((row) => row.Id === id);
      if (found && !picked.includes(found)) picked.push(found);
    }
    if (picked.length > 0) return picked;
    const fallback = getDefaultAiModel(rows);
    return fallback ? [fallback] : [];
  }, []);

  /** Runs one AI chat request through the ordered model list: a failed
   *  request (network, provider, empty output, invalid config) is retried
   *  with the next model until one succeeds or every model has failed. */
  const chatWithFailover = useCallback(
    async (params: {
      messages: { role: "system" | "user" | "assistant"; content: string }[];
      images?: string[];
    }): Promise<string> => {
      const ai = window.readlynx?.ai;
      const candidates = orderedModelCandidates();
      if (!ai) throw new Error("The AI bridge is not available.");
      if (candidates.length === 0) {
        throw new Error("No AI model configured. Add one in Settings → AI Models.");
      }
      const failures: string[] = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const label = candidate.DisplayName ?? candidate.ModelName ?? candidate.Id;
        if (!candidate.APIKey || !candidate.ModelName) {
          failures.push(`${label}: missing API key or model name`);
          continue;
        }
        let input: { url: string; apiKey: string; modelName: string };
        try {
          input = {
            url: resolveProviderBaseUrl(candidate),
            apiKey: candidate.APIKey,
            modelName: candidate.ModelName,
          };
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        try {
          const response = await ai.chat({ input, messages: params.messages, images: params.images });
          const text = response.trim();
          if (!text) {
            failures.push(`${label}: returned an empty translation`);
            continue;
          }
          return text;
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const next = candidates[index + 1];
        if (next) {
          setStatus(`"${label}" failed — retrying with "${next.DisplayName ?? next.ModelName ?? next.Id}"…`);
        }
      }
      throw new Error(
        `All ${candidates.length} model${candidates.length === 1 ? "" : "s"} failed — ${failures.join("; ")}`,
      );
    },
    [orderedModelCandidates],
  );

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
    if (!(busy && sourceType === "pdf" && settings.pdfMethod === "ocr")) return;
    const unsubscribe =
      window.readlynx?.ocr.onRecognizeProgress(({ progress }) => {
        setStatus(`Recognizing page… ${Math.round(progress * 100)}%`);
      });
    return () => unsubscribe?.();
  }, [busy, sourceType, settings.pdfMethod]);

  /** Rate-limit retry indicator: shows "retrying (attempt N)" while the AI
   *  call is being retried due to HTTP 429. */
  useEffect(() => {
    if (!busy) return;
    const unsubscribe =
      window.readlynx?.ai.onRateLimitRetry(({ attempt }) => {
        setRateLimitRetry(attempt);
        const base = baseStatusRef.current;
        if (base) {
          setStatus(`${base} (retrying – attempt ${attempt})`);
        }
      });
    return () => {
      unsubscribe?.();
      setRateLimitRetry(null);
    };
  }, [busy]);

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
      chunkKey: string;
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
        sourceLang: "",
        targetLang: current.targetLang,
        customPrompt: customPromptRef.current,
        markdown: translation.markdown,
        updatedAt: "",
      });
    },
    [bookId, sourceType],
  );

  /** Runs the full PDF pipeline for one page — capture → OCR or AI vision →
   *  model — and persists the result row. Shared by the single-page action
   *  and the page-range translation. Reads the toolbar settings at call
   *  time, so every page of a range is processed with the same choices. */
  const translatePdfPage = useCallback(
    async (page: number): Promise<string> => {
      const db = window.readlynx?.db;
      if (!db) throw new Error("The AI bridge is not available.");
      const currentSettings = settingsRef.current;
      const method = methodFor("pdf", currentSettings.pdfMethod);
      const docType = docTypeFor("pdf", currentSettings.pdfMethod);
      const promptContext = {
        docType,
        ocrLangs: currentSettings.ocrLangs,
        targetLang: currentSettings.targetLang,
        customPrompt: customPromptRef.current,
      };
      const systemPrompt = buildTranslationSystemPrompt(promptContext);

      const image = await pdfRef.current?.getPageImage(page);
      if (!image) {
        throw new Error(`The image of page ${page} is not available yet.`);
      }
      // Cancel checkpoint: never delete cached rows of a page that will not
      // be regenerated.
      if (cancelRequestedRef.current) {
        throw new TranslationCancelledError("Translation cancelled.");
      }
      // Always remove old rows for this page before saving the fresh result
      // so that repeated translations (single-page, range, or regenerate)
      // never leave duplicate rows in the database.
      await db.deleteTranslations({ bookId, pageNumber: page });
      let result: string;
      if (method === "ocr") {
        const ocrResult = await window.readlynx?.ocr.recognize({
          dataUrl: image,
          langs: currentSettings.ocrLangs,
        });
        if (!ocrResult) throw new Error("OCR is unavailable.");
        if (ocrResult.error) throw new Error(ocrResult.error);
        const text = (ocrResult.text ?? "").trim();
        if (!text) throw new Error(`No text detected on page ${page}.`);
        // Cancel checkpoint: skip the (slow) model call when the user bailed.
        if (cancelRequestedRef.current) {
          throw new TranslationCancelledError("Translation cancelled.");
        }
        result = await chatWithFailover({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildTranslationUserPrompt(promptContext, text) },
          ],
        });
      } else {
        if (cancelRequestedRef.current) {
          throw new TranslationCancelledError("Translation cancelled.");
        }
        result = await chatWithFailover({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildTranslationUserPrompt(promptContext, "") },
          ],
          images: [image],
        });
      }
      const normalized = normalizeTranslatedMarkdown(result);
      await saveRow({ method, pageNumber: page, chunkKey: "", markdown: normalized });
      return normalized;
    },
    [bookId, pdfRef, saveRow, chatWithFailover],
  );

  /** Translates a contiguous range of PDF pages in ascending order, applying
   *  the toolbar settings (method, model, languages, instruction) to every
   *  page. Pages already cached are regenerated. */
  const translateRange = useCallback(
    async (from: number, to: number) => {
      if (sourceType !== "pdf") return;
      if (busyRef.current) return;
      const count = to - from + 1;
      if (!Number.isInteger(from) || !Number.isInteger(to) || count <= 0) {
        setError("Pick a valid page range (from ≤ to).");
        return;
      }
      if (orderedModelCandidates().length === 0) {
        setError("No AI model configured. Add one in Settings → AI Models.");
        return;
      }

      busyRef.current = true;
      busyUnitRef.current = unitKeyRef.current;
      setBusy(true);
      setError(null);
      setStatus(null);
      cancelRequestedRef.current = false;
      let done = 0;
      setRangeProgress({ done: 0, total: count });
      try {
        for (let page = from; page <= to; page += 1) {
          // Cancel checkpoint: stop at the page boundary — every finished
          // page keeps its fresh row, the rest are left untouched.
          if (cancelRequestedRef.current) break;
          setStatus(`Page ${page} of ${to}…`);
          await translatePdfPage(page);
          done += 1;
          setRangeProgress({ done, total: count });
        }
        setStatus(
          cancelRequestedRef.current
            ? `Cancelled — ${done} of ${count} page${count === 1 ? "" : "s"} translated.`
            : `Translated ${count} page${count === 1 ? "" : "s"} (${from}–${to}).`,
        );
        setRangeProgress(null);
        // The on-screen unit may fall inside the range: re-read its rows.
        setRefreshTick((tick) => tick + 1);
      } catch (err) {
        // Pages finished before the failure keep their rows; the rest are
        // untouched.
        setRangeProgress(null);
        if (err instanceof TranslationCancelledError) {
          setStatus(`Cancelled — ${done} of ${count} page${count === 1 ? "" : "s"} translated.`);
        } else {
          setError(err instanceof Error ? err.message : String(err));
          setStatus(null);
        }
      } finally {
        busyRef.current = false;
        busyUnitRef.current = null;
        setBusy(false);
      }
    },
    [sourceType, translatePdfPage, orderedModelCandidates],
  );

  /** Asks the running translation to stop at the next checkpoint. The
   *  toolbar shows this as the Cancel action while a range is in flight. */
  const cancelTranslation = useCallback(() => {
    cancelRequestedRef.current = true;
    setStatus("Cancelling…");
  }, []);

  /** Translates the current unit. With `force`, regeneration bypasses the
   *  cache and overwrites the stored rows. */
  const translate = useCallback(async (force = false) => {
    const key = unitKeyRef.current;
    if (!key) {
      setError("Nothing to translate yet — open the book first.");
      return;
    }
    // Prevent duplicate concurrent translates for the same unit, but allow
    // different units to translate independently (e.g. the old chapter's
    // translate continues in the background while a new chapter starts).
    if (busyUnitRef.current === key) return;
    if (!force && hasTranslationRef.current) return;

    if (orderedModelCandidates().length === 0) {
      setError("No AI model configured. Add one in Settings → AI Models.");
      return;
    }

    const currentSettings = settingsRef.current;
    const method = methodFor(sourceType, currentSettings.pdfMethod);
    const docType = docTypeFor(sourceType, currentSettings.pdfMethod);
    const promptContext = {
      docType,
      ocrLangs: currentSettings.ocrLangs,
      targetLang: currentSettings.targetLang,
      customPrompt: customPromptRef.current,
    };
    const systemPrompt = buildTranslationSystemPrompt(promptContext);

    busyUnitRef.current = key;
    setBusy(true);
    setError(null);
    setStatus(null);
    cancelRequestedRef.current = false;

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
        // A partially translated chapter is useless: chunk results stay in
        // memory and are only written to the database once every chunk has
        // been translated, so a cancel or failure mid-chapter leaves the
        // previously cached (complete) translation untouched.
        const results: string[] = [];
        for (let index = 0; index < chunks.length; index += 1) {
          // Cancel checkpoint: stop at the chunk boundary — nothing has been
          // written yet, so the cache is untouched.
          if (cancelRequestedRef.current) {
            throw new TranslationCancelledError("Translation cancelled.");
          }
          const chunkStatus =
            chunks.length === 1
              ? "Translating chapter…"
              : `Translating chunk ${index + 1} of ${chunks.length}…`;
          baseStatusRef.current = chunkStatus;
          setRateLimitRetry(null);
          setStatus(chunkStatus);
          const chunkRaw = await chatWithFailover({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: buildTranslationUserPrompt(promptContext, chunks[index]) },
            ],
          });
          // Normalize each chunk so the rows written below are clean; the
          // final joined result is normalized again after image replacement.
          const chunk = normalizeTranslatedMarkdown(chunkRaw);
          setRateLimitRetry(null);
          baseStatusRef.current = null;
          results.push(chunk);
        }
        // Save EPUB images to FileStore and replace [IMG-n] tokens with
        // protocol URLs so the cached translation works without the viewer.
        const joined = normalizeTranslatedMarkdown(results.join("\n\n"));
        const hasImgTokens = joined.includes("[IMG-");
        let chunkMarkdowns = results;
        if (hasImgTokens && extraction.images.length > 0) {
          const dataUrls = extraction.images.map((img) => extractDataUrlFromImageRef(img)).filter((d): d is string => d !== null);
          if (dataUrls.length > 0) {
            // Remove old images for this chapter before saving new ones
            // so regenerated chapters don't leave orphaned files.
            await window.readlynx?.translationImages?.delete({ bookId, chapterKeyPrefix: chapterKey });
            const protocolUrls = await window.readlynx?.translationImages?.save({
              bookId,
              chapterKey,
              dataUrls,
            });
            if (protocolUrls) {
              result = replaceImageTokensWithProtocolUrls(joined, extraction.images, protocolUrls);
              chunkMarkdowns = results.map((chunk) =>
                replaceImageTokensWithProtocolUrls(chunk, extraction.images, protocolUrls),
              );
            } else {
              result = replaceImageTokens(joined, extraction.images);
            }
          } else {
            result = replaceImageTokens(joined, extraction.images);
          }
        } else {
          result = joined;
        }
        // The complete chapter is ready: drop every cached chunk of this
        // chapter (incl. stale chunks from earlier, differently-chunked
        // generations) and write the fresh set in one pass — prevents
        // duplicate rows when re-translating and never leaves a partial
        // chapter in the database.
        await window.readlynx?.db.deleteTranslations({ bookId, chunkKeyPrefix: chapterKey });
        for (let index = 0; index < chunks.length; index += 1) {
          await window.readlynx?.db.putTranslation({
            id: crypto.randomUUID(),
            bookId,
            sourceType,
            method,
            pageNumber: null,
            chunkKey: chunkKeyFor(chapterKey, index),
            sourceLang: "",
            targetLang: currentSettings.targetLang,
            customPrompt: customPromptRef.current,
            markdown: chunkMarkdowns[index],
            updatedAt: "",
          });
        }
      } else {
        const page = unitToPage(key) ?? 1;
        setStatus(method === "ocr" ? "Recognizing page…" : "Translating page with AI vision…");
        result = await translatePdfPage(page);
      }
      // Only update the displayed markdown if the user hasn't navigated
      // away — otherwise the old chapter's result would overwrite the
      // current view and cause a stuck loading spinner.
      if (unitKeyRef.current === key) {
        setMarkdown(result);
        setMarkdownUnitKey(key);
        setHasTranslation(true);
        setImagesPending(false);
        rawCachedMarkdownRef.current = null;
      }
      setStatus(null);
      setRateLimitRetry(null);
      baseStatusRef.current = null;
      // The user asked for the translation — take them to it once it's done,
      // but only if they haven't navigated to a different unit in the meantime.
      if (unitKeyRef.current === key) {
        setViewModeState("translation");
      }
    } catch (err) {
      // Previous translations are kept untouched — rows are only written
      // after a successful generation.
      if (err instanceof TranslationCancelledError) {
        setStatus("Translation cancelled.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setStatus(null);
      }
      setRateLimitRetry(null);
      baseStatusRef.current = null;
    } finally {
      // Only clear if this unit is still the one we were translating —
      // a newer translate call may have taken over.
      if (busyUnitRef.current === key) {
        busyUnitRef.current = null;
        setBusy(false);
      }
    }
  }, [epubRef, saveRow, translatePdfPage, sourceType, bookId, chatWithFailover, orderedModelCandidates]);

  const regenerate = useCallback(() => {
    void translate(true);
  }, [translate]);

  /** Auto-starts translation when the user enters translation view and the
   *  current unit has no cached result yet. */
  useEffect(() => {
    if (viewMode !== "translation") return;
    if (!unitKey || !cacheReady || hasTranslation || error) return;
    // Don't start if this exact unit is already being translated.
    if (busyUnitRef.current === unitKey) return;
    // Don't start if a range translation is in progress for any unit.
    if (busyRef.current) return;
    if (autoTriedRef.current === unitKey) return;
    autoTriedRef.current = unitKey;
    void translate(false);
    // Intentionally re-checked whenever these inputs change; the
    // `autoTriedRef` guard keeps it from re-running per unit.
  }, [viewMode, unitKey, cacheReady, hasTranslation, error, translate]);

  return {
    viewMode,
    setViewMode,
    pdfMethod: settings.pdfMethod,
    setPdfMethod: (method: TranslationMethod) => updateSettings({ pdfMethod: method }),
    settings,
    updateSettings,
    setUnit: setUnitKey,
    unitKey,
markdown,
    /** True while the shown markdown belongs to the previous unit (the new
     *  unit's rows are being read) — the viewer stays mounted underneath. */
    markdownLoading: markdown !== null && markdownUnitKey !== unitKey,
    /** True while waiting for the EPUB viewer to load so cached image tokens
     *  can be resolved into real image URLs. */
    imagesPending,
    /** True once the cache lookup for the current unit has finished (whether
     *  a translation was found or not). While false the DB fetch is still in
     *  flight and the UI should keep a loading veil instead of flashing
     *  "No translation yet". */
    cacheReady,
    busy,
    status,
    error,
    hasTranslation,
    models,
    modelsError,
    installed,
    downloading,
    downloadProgress,
    downloadModel,
    deleteModel,
    refreshModels,
    refreshCustomPrompt,
    translate,
    translateRange,
    cancelTranslation,
    rangeProgress,
    regenerate,
    rateLimitRetry,
  };
}