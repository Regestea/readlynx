const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readlynx", {
  exportPdf: (options) => ipcRenderer.invoke("export-pdf", options),
  onPrepareClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:prepare-close", listener);
    return () => ipcRenderer.removeListener("app:prepare-close", listener);
  },
  notifyReadyToClose: () => ipcRenderer.send("app:ready-to-close"),
  onHttpLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("http:log", listener);
    return () => ipcRenderer.removeListener("http:log", listener);
  },
  readFileBytes: (filePath) => ipcRenderer.invoke("fs:read-bytes", filePath),
  readCoverDataUrl: (relativePath) => ipcRenderer.invoke("cover:read-data-url", relativePath),
  pickFile: (options) => ipcRenderer.invoke("fs:pick-file", options),
  importSource: (options) => ipcRenderer.invoke("fs:import-source", options),
  fileIdentity: (sourcePath) => ipcRenderer.invoke("fs:file-identity", sourcePath),
  replaceSource: (options) => ipcRenderer.invoke("fs:replace-source", options),
  /** OS "Open with" delivery: pushed while running, pulled on cold start. */
  onOpenFile: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on("app:open-file", listener);
    return () => ipcRenderer.removeListener("app:open-file", listener);
  },
  getPendingFile: () => ipcRenderer.invoke("app:get-pending-file"),
  captureRect: (rect) => ipcRenderer.invoke("fs:capture-rect", rect),
  backup: {
    create: () => ipcRenderer.invoke("backup:create"),
    restore: () => ipcRenderer.invoke("backup:restore"),
  },
  translationImages: {
    save: (payload) => ipcRenderer.invoke("translation-images:save", payload),
    delete: (payload) => ipcRenderer.invoke("translation-images:delete", payload),
    deleteAllForBook: (bookId) => ipcRenderer.invoke("translation-images:delete-all-for-book", bookId),
  },
  ocr: {
    getInfo: () => ipcRenderer.invoke("ocr:get-info"),
    downloadModel: (lang) => ipcRenderer.invoke("ocr:download-model", lang),
    deleteModel: (lang) => ipcRenderer.invoke("ocr:delete-model", lang),
    recognize: (payload) => ipcRenderer.invoke("ocr:recognize", payload),
    onDownloadProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("ocr:download-progress", listener);
      return () => ipcRenderer.removeListener("ocr:download-progress", listener);
    },
    onRecognizeProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("ocr:recognize-progress", listener);
      return () => ipcRenderer.removeListener("ocr:recognize-progress", listener);
    },
  },
  db: {
    createBook: () => ipcRenderer.invoke("db:create-book"),
    createTranslatedBook: (payload) => ipcRenderer.invoke("db:create-translated-book", payload),
    createReadingBook: (payload) => ipcRenderer.invoke("db:create-reading-book", payload),
    findBookBySourceHash: (fileHash, fileSize) =>
      ipcRenderer.invoke("db:find-book-by-source-hash", { fileHash, fileSize }),
    findBookByOriginalPath: (originalPath) =>
      ipcRenderer.invoke("db:find-book-by-original-path", originalPath),
    refreshBookSource: (payload) => ipcRenderer.invoke("db:refresh-book-source", payload),
    updateBookOriginalPath: (bookId, originalPath) =>
      ipcRenderer.invoke("db:update-book-original-path", { bookId, originalPath }),
    saveDocument: (payload) => ipcRenderer.invoke("db:save-document", payload),
    listBooks: () => ipcRenderer.invoke("db:list-books"),
    getBook: (bookId) => ipcRenderer.invoke("db:get-book", bookId),
    deleteBook: (bookId) => ipcRenderer.invoke("db:delete-book", bookId),
    updateBook: (payload) => ipcRenderer.invoke("db:update-book", payload),
    setBookPinned: (bookId, pinned) =>
      ipcRenderer.invoke("db:set-book-pinned", { bookId, pinned }),
    getAppSettings: () => ipcRenderer.invoke("db:get-app-settings"),
    updateAppSettings: (patch) => ipcRenderer.invoke("db:update-app-settings", patch),
    listAiModels: () => ipcRenderer.invoke("db:ai-models-list"),
    createAiModel: (model) => ipcRenderer.invoke("db:ai-model-create", model),
    updateAiModel: (model) => ipcRenderer.invoke("db:ai-model-update", model),
    deleteAiModel: (id) => ipcRenderer.invoke("db:ai-model-delete", id),
    setDefaultAiModel: (id) => ipcRenderer.invoke("db:ai-model-set-default", id),
    getReadingState: (bookId) => ipcRenderer.invoke("db:reading-state-get", bookId),
    updateReadingState: (bookId, state) =>
      ipcRenderer.invoke("db:reading-state-update", { bookId, ...state }),
    markReadingStateOpened: (bookId) => ipcRenderer.invoke("db:reading-state-mark-opened", bookId),
    finalizeReadingState: (bookId) => ipcRenderer.invoke("db:reading-state-finalize", bookId),
    appendReadingEvent: (bookId, startedAt, endedAt) =>
      ipcRenderer.invoke("db:reading-state-add-time", { bookId, startedAt, endedAt }),
    listReadingProgress: () => ipcRenderer.invoke("db:reading-progress-list"),
    getWeekReadingEvents: () => ipcRenderer.invoke("db:reading-events-week"),
    getDailyGoal: () => ipcRenderer.invoke("db:reading-goal-get"),
    setDailyGoal: (minutes) => ipcRenderer.invoke("db:reading-goal-set", { minutes }),
    getReaderSettings: (bookId, viewer) =>
      ipcRenderer.invoke("db:reader-settings-get", { bookId, viewer }),
    updateReaderSettings: (bookId, viewer, settings) =>
      ipcRenderer.invoke("db:reader-settings-update", { bookId, viewer, ...settings }),
    getReaderDefaults: (viewer) =>
      ipcRenderer.invoke("db:reader-defaults-get", { viewer }),
    listReaderDefaults: () => ipcRenderer.invoke("db:reader-defaults-list"),
    updateReaderDefaults: (viewer, settings) =>
      ipcRenderer.invoke("db:reader-defaults-update", { viewer, ...settings }),
    getTranslations: (options) => ipcRenderer.invoke("db:translation-get", options),
    getTranslationUnits: (bookId) => ipcRenderer.invoke("db:translation-units", bookId),
    putTranslation: (translation) => ipcRenderer.invoke("db:translation-put", translation),
    deleteTranslations: (options) => ipcRenderer.invoke("db:translation-delete", options),
    listCustomInstructions: () => ipcRenderer.invoke("db:custom-instructions-list"),
    createCustomInstruction: (instruction) =>
      ipcRenderer.invoke("db:custom-instruction-create", instruction),
    updateCustomInstruction: (instruction) =>
      ipcRenderer.invoke("db:custom-instruction-update", instruction),
    deleteCustomInstruction: (id) =>
      ipcRenderer.invoke("db:custom-instruction-delete", id),
  },
  ai: {
    testConnection: (input) => ipcRenderer.invoke("ai:test", input),
    listGeminiModels: (apiKey) => ipcRenderer.invoke("ai:list-gemini-models", apiKey),
    chat: (payload) => ipcRenderer.invoke("ai:chat", payload),
    structured: (payload) => ipcRenderer.invoke("ai:structured", payload),
    cancel: (requestId) => ipcRenderer.invoke("ai:cancel", requestId),
    onRateLimitRetry: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("ai:rate-limit-retry", listener);
      return () => ipcRenderer.removeListener("ai:rate-limit-retry", listener);
    },
  },
  systemFonts: {
    list: () => ipcRenderer.invoke("fonts:list"),
  },
});
