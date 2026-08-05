const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readlynx", {
  exportPdf: (options) => ipcRenderer.invoke("export-pdf", options),
  readFileBytes: (filePath) => ipcRenderer.invoke("fs:read-bytes", filePath),
  pickFile: (options) => ipcRenderer.invoke("fs:pick-file", options),
  db: {
    createBook: () => ipcRenderer.invoke("db:create-book"),
    saveDocument: (payload) => ipcRenderer.invoke("db:save-document", payload),
    listBooks: () => ipcRenderer.invoke("db:list-books"),
    getBook: (bookId) => ipcRenderer.invoke("db:get-book", bookId),
    deleteBook: (bookId) => ipcRenderer.invoke("db:delete-book", bookId),
    getAppSettings: () => ipcRenderer.invoke("db:get-app-settings"),
    updateAppSettings: (theme) => ipcRenderer.invoke("db:update-app-settings", theme),
  },
});
