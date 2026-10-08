import { ipcMain } from "electron";
import {
  cancelDownload,
  checkForUpdates,
  installUpdate,
  openExternalLink,
  releasesPage,
} from "../updater.ts";
import type { UpdateInstallResult, UpdateProgress } from "../../src/shared/updater.ts";

/** Update channels. Every reply is a value (never a rejection) so the renderer
 *  can render the outcome instead of only an error string; the download
 *  progress is pushed separately, since it is far too chatty for a reply. */
export function registerUpdaterIpc() {
  ipcMain.handle("updater:check", () => checkForUpdates());

  ipcMain.handle(
    "updater:install",
    async (event): Promise<UpdateInstallResult> => {
      const send = (progress: UpdateProgress) => {
        if (!event.sender.isDestroyed()) event.sender.send("updater:progress", progress);
      };
      try {
        return await installUpdate(send);
      } catch (error) {
        return {
          ok: false,
          restarting: false,
          message: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle("updater:cancel", () => {
    cancelDownload();
    return true;
  });

  /** Opens the release page — the fallback when the release ships no build for
   *  this platform, or when the install had to be handed to the user. */
  ipcMain.handle("updater:open-releases", async () => {
    await openExternalLink(releasesPage());
    return true;
  });

  /** Opens a link found inside the release notes (see `openExternalLink` for
   *  the github.com-only restriction). */
  ipcMain.handle("updater:open-link", async (_event, url: string) =>
    openExternalLink(typeof url === "string" ? url : ""),
  );
}