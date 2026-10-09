import type {
  BookListItem,
  BookSourceLookupResult,
  CreateBookResult,
  CreateReadingBookPayload,
  CreateReadingBookResult,
  CreateTranslatedBookPayload,
  GetBookResult,
  ReadingProgressRow,
  ReadingWeekSummary,
  RefreshBookSourcePayload,
  SaveDocumentPayload,
  UpdateBookPayload,
} from "./infrastructure/db/entities";
import type { AiModel } from "./infrastructure/db/entities";
import type { AppSettingsEntity } from "./infrastructure/db/entities";
import type { CustomInstructionEntity } from "./infrastructure/db/entities";
import type { ReadingStateEntity } from "./infrastructure/db/entities";
import type { ReaderSettingsEntity, ReaderViewer } from "./infrastructure/db/entities";
import type { ReaderDefaultsEntity } from "./infrastructure/db/entities";
import type { ReadingStateInput } from "./infrastructure/db/repositories";
import type { ReaderSettingsInput } from "./infrastructure/db/repositories";
import type { TranslationEntity, TranslationMethod } from "./infrastructure/db/entities";
import type { UpdateCheckResult, UpdateInstallResult, UpdateProgress } from "./shared/updater";

export {};

declare global {
  interface Window {
    readlynx?: {
      /** Custom title bar controls — the window has no OS caption
       *  (`titleBarStyle: "hidden"`). `close` goes through the same save-flush
       *  handshake as the OS close button, so it never drops pending writes. */
      windowControls: {
        minimize(): Promise<void>;
        /** Maximizes or restores; resolves to the new maximized state. */
        toggleMaximize(): Promise<boolean>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
        /** What this window is for. Pulled once on mount so a reader window
         *  paints its book rather than the whole shell for a frame. */
        getContext(): Promise<{ role: "main" | "reader"; bookId: string | null }>;
        /** Opens a book in its own window, focusing one already showing it.
         *  Ignored when called from a reader window. */
        openBook(bookId: string): Promise<boolean>;
        /** Fires on state changes the user did not ask for (taskbar
         *  double-click, Win+Up, snap layouts, a restored size). */
        onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
      };
      exportPdf(options: {
        defaultPath: string;
        html: string;
      }): Promise<string | null>;
      onPrepareClose(callback: () => void): () => void;
      notifyReadyToClose(): void;
      /** Main-process HTTP request log lines (AI, OCR downloads, …), mirrored
       *  so they show up in the DevTools console. `body` is the (redacted)
       *  request body and `responseBody` the (redacted) JSON response body,
       *  when present. */
      onHttpLog(
        callback: (payload: {
          line: string;
          body?: unknown;
          responseBody?: unknown;
        }) => void,
      ): () => void;
      readFileBytes(filePath: string): Promise<ArrayBuffer | null>;
      readCoverDataUrl(relativePath: string): Promise<string | null>;
      pickFile(options?: {
        filters?: { name: string; extensions: string[] }[];
      }): Promise<string | null>;
      importSource(options: {
        sourcePath: string;
        sourceType: string;
      }): Promise<string | null>;
      /** Byte size + streaming sha256 of an outside file (dedupe key). */
      fileIdentity(sourcePath: string): Promise<{ fileSize: number; fileHash: string } | null>;
      /** Overwrites an imported `books/<uuid>` copy with fresh outside bytes. */
      replaceSource(options: { storedPath: string; sourcePath: string }): Promise<boolean>;
      /** OS "Open with" events (file association / double-click). */
      onOpenFile(callback: (filePath: string) => void): () => void;
      /** Cold-start file queued before the renderer mounted. */
      getPendingFile(): Promise<string | null>;
      captureRect(rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }): Promise<string | null>;
      backup: {
        create(): Promise<{ ok: boolean; path?: string; error?: string } | null>;
        restore(): Promise<{ ok: boolean; path?: string; error?: string } | null>;
      };
      translationImages: {
        save(payload: {
          bookId: string;
          chapterKey: string;
          dataUrls: string[];
        }): Promise<string[]>;
        delete(payload: {
          bookId: string;
          chapterKeyPrefix?: string;
        }): Promise<boolean>;
        deleteAllForBook(bookId: string): Promise<boolean>;
      };
      ocr: {
        getInfo(): Promise<{ dir: string; installed: string[] }>;
        downloadModel(lang: string): Promise<{
          ok: boolean;
          lang: string;
          bytes?: number;
          error?: string;
        }>;
        deleteModel(lang: string): Promise<{ ok: boolean; lang: string }>;
        recognize(payload: {
          dataUrl: string;
          langs: string[];
        }): Promise<{ text?: string; error?: string }>;
        onDownloadProgress(
          callback: (data: { lang: string; received: number; total: number }) => void,
        ): () => void;
        onRecognizeProgress(callback: (data: { progress: number }) => void): () => void;
      };
      db: {
        createBook(): Promise<CreateBookResult>;
        createTranslatedBook(payload: CreateTranslatedBookPayload): Promise<CreateBookResult>;
        createReadingBook(payload: CreateReadingBookPayload): Promise<CreateReadingBookResult>;
        findBookBySourceHash(
          fileHash: string,
          fileSize: number,
        ): Promise<BookSourceLookupResult | null>;
        findBookByOriginalPath(originalPath: string): Promise<BookSourceLookupResult | null>;
        refreshBookSource(payload: RefreshBookSourcePayload): Promise<boolean>;
        updateBookOriginalPath(bookId: string, originalPath: string): Promise<boolean>;
        saveDocument(payload: SaveDocumentPayload): Promise<{ documentId: string } | null>;
        listBooks(): Promise<BookListItem[]>;
        getBook(bookId: string): Promise<GetBookResult | null>;
        deleteBook(bookId: string): Promise<boolean>;
        updateBook(payload: UpdateBookPayload): Promise<BookListItem | null>;
        setBookPinned(bookId: string, pinned: boolean): Promise<BookListItem | null>;
        getAppSettings(): Promise<AppSettingsEntity | null>;
        updateAppSettings(patch: {
          theme?: string;
          chatZoom?: number;
        }): Promise<AppSettingsEntity | null>;
        listAiModels(): Promise<AiModel[]>;
        createAiModel(model: AiModel): Promise<boolean>;
        updateAiModel(model: AiModel): Promise<boolean>;
        deleteAiModel(id: string): Promise<boolean>;
        setDefaultAiModel(id: string): Promise<boolean>;
        getReadingState(bookId: string): Promise<ReadingStateEntity | null>;
        updateReadingState(
          bookId: string,
          state: ReadingStateInput,
        ): Promise<ReadingStateEntity | null>;
        markReadingStateOpened(bookId: string): Promise<boolean>;
        finalizeReadingState(bookId: string): Promise<boolean>;
        appendReadingEvent(bookId: string, startedAt: number, endedAt: number): Promise<boolean>;
        listReadingProgress(): Promise<ReadingProgressRow[]>;
        getWeekReadingEvents(): Promise<ReadingWeekSummary>;
        getDailyGoal(): Promise<{ goalMinutes: number }>;
        setDailyGoal(minutes: number): Promise<{ goalMinutes: number }>;
        getReaderSettings(
          bookId: string,
          viewer: ReaderViewer,
        ): Promise<ReaderSettingsEntity | null>;
        updateReaderSettings(
          bookId: string,
          viewer: ReaderViewer,
          settings: ReaderSettingsInput,
        ): Promise<boolean>;
        getReaderDefaults(viewer: ReaderViewer): Promise<ReaderDefaultsEntity | null>;
        listReaderDefaults(): Promise<ReaderDefaultsEntity[]>;
        updateReaderDefaults(
          viewer: ReaderViewer,
          settings: ReaderSettingsInput,
        ): Promise<boolean>;
        getTranslations(options: {
          bookId: string;
          method?: TranslationMethod;
          pageNumber?: number | null;
          chunkKeyPrefix?: string | null;
          /** Read every row of the book instead of one page / chapter. */
          all?: boolean;
        }): Promise<TranslationEntity[]>;
        getTranslationUnits(bookId: string): Promise<{
          pages: number[];
          chapters: string[];
        }>;
        putTranslation(translation: TranslationEntity): Promise<boolean>;
        deleteTranslations(options: {
          bookId: string;
          method?: TranslationMethod;
          pageNumber?: number | null;
          chunkKeyPrefix?: string | null;
        }): Promise<boolean>;
        listCustomInstructions(): Promise<CustomInstructionEntity[]>;
        createCustomInstruction(
          instruction: CustomInstructionEntity,
        ): Promise<boolean>;
        updateCustomInstruction(
          instruction: CustomInstructionEntity,
        ): Promise<boolean>;
        deleteCustomInstruction(id: string): Promise<boolean>;
      };
      ai: {
        testConnection(input: {
          url: string;
          apiKey: string;
          modelName: string;
        }): Promise<{ ok: boolean; message?: string; error?: string }>;
        listGeminiModels(apiKey: string): Promise<{ value: string; label: string }[]>;
        chat(payload: {
          input: { url: string; apiKey: string; modelName: string };
          messages: { role: "system" | "user" | "assistant"; content: string }[];
          images?: string[];
          /** Client-generated id so the request can be aborted via `cancel`. */
          requestId?: string;
        }): Promise<string>;
        structured(payload: {
          input: { url: string; apiKey: string; modelName: string };
          options: {
            systemPrompt?: string;
            prompt: string;
            images?: string[];
            jsonSchema: Record<string, unknown>;
          };
          requestId?: string;
        }): Promise<unknown>;
        /** Aborts the in-flight AI HTTP request(s). With a `requestId` only
         *  that request is aborted, without it every pending request is. */
        cancel(requestId?: string): Promise<boolean>;
        onRateLimitRetry(
          callback: (data: { attempt: number }) => void,
        ): () => void;
      };
      systemFonts: {
        /** All font families installed on the OS (queried from the main
         *  process — includes user-installed fonts). */
        list(): Promise<string[]>;
      };
      updater: {
        /** Asks GitHub for the newest published release and compares it with
         *  the running build. `disabled` is true in a dev run. */
        check(): Promise<UpdateCheckResult>;
        /** Downloads the build the last check picked, verifies its sha256 and
         *  installs it. Takes no arguments: the target is chosen in the main
         *  process. */
        install(): Promise<UpdateInstallResult>;
        /** Aborts the running download. */
        cancel(): Promise<boolean>;
        /** Opens the release page in the system browser. */
        openReleases(): Promise<boolean>;
        /** Opens an https github.com link in the system browser; anything else
         *  is rejected (release notes are remote content). */
        openLink(url: string): Promise<boolean>;
        onProgress(callback: (progress: UpdateProgress) => void): () => void;
      };
    };
  }
}
