const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readlynx", {
  exportPdf: (options) => ipcRenderer.invoke("export-pdf", options),
  readFileBytes: (filePath) => ipcRenderer.invoke("fs:read-bytes", filePath),
  readCoverDataUrl: (relativePath) => ipcRenderer.invoke("cover:read-data-url", relativePath),
  pickFile: (options) => ipcRenderer.invoke("fs:pick-file", options),
  importSource: (options) => ipcRenderer.invoke("fs:import-source", options),
  captureRect: (rect) => ipcRenderer.invoke("fs:capture-rect", rect),
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
    saveDocument: (payload) => ipcRenderer.invoke("db:save-document", payload),
    listBooks: () => ipcRenderer.invoke("db:list-books"),
    getBook: (bookId) => ipcRenderer.invoke("db:get-book", bookId),
    deleteBook: (bookId) => ipcRenderer.invoke("db:delete-book", bookId),
    getAppSettings: () => ipcRenderer.invoke("db:get-app-settings"),
    updateAppSettings: (theme) => ipcRenderer.invoke("db:update-app-settings", theme),
    listAiModels: () => ipcRenderer.invoke("db:ai-models-list"),
    createAiModel: (model) => ipcRenderer.invoke("db:ai-model-create", model),
    updateAiModel: (model) => ipcRenderer.invoke("db:ai-model-update", model),
    deleteAiModel: (id) => ipcRenderer.invoke("db:ai-model-delete", id),
    setDefaultAiModel: (id) => ipcRenderer.invoke("db:ai-model-set-default", id),
    getReadingState: (bookId) => ipcRenderer.invoke("db:reading-state-get", bookId),
    updateReadingState: (bookId, state) =>
      ipcRenderer.invoke("db:reading-state-update", { bookId, ...state }),
    getTranslations: (options) => ipcRenderer.invoke("db:translation-get", options),
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
  },
});
