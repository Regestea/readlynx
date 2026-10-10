import { clipboard, ipcMain } from "electron";

/** IPC: system clipboard writes. The renderer asks the main process rather
 *  than using `navigator.clipboard`, which needs a focused, secure-context
 *  document: a page-text copy runs after an OCR or an AI round trip, and by
 *  then focus can sit anywhere (a popover, another panel), which makes the
 *  browser API reject the write. The main process owns the real clipboard, so
 *  the copy lands either way. */
export function registerClipboardIpc() {
  ipcMain.handle("clipboard:write-text", (_event, text: unknown) => {
    if (typeof text !== "string" || text.length === 0) return false;
    clipboard.writeText(text);
    return true;
  });
}