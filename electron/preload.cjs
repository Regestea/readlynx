const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readlynx", {
  exportPdf: (options) => ipcRenderer.invoke("export-pdf", options),
  readFileBytes: (filePath) => ipcRenderer.invoke("fs:read-bytes", filePath),
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
    saveDocument: (payload) => ipcRenderer.invoke("db:save-document", payload),
    listBooks: () => ipcRenderer.invoke("db:list-books"),
    getBook: (bookId) => ipcRenderer.invoke("db:get-book", bookId),
    deleteBook: (bookId) => ipcRenderer.invoke("db:delete-book", bookId),
    getAppSettings: () => ipcRenderer.invoke("db:get-app-settings"),
    updateAppSettings: (theme) => ipcRenderer.invoke("db:update-app-settings", theme),
  },
});
