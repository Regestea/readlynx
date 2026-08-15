import { ipcMain } from "electron";
import fontList from "font-list";

/** IPC: system font enumeration. The main process queries the OS directly
 *  (registry on Windows, `system_profiler` on macOS, `fc-list` on Linux), so
 *  the renderer gets every font installed on the machine — including fonts
 *  the user installed themselves, which the renderer-side measurement probe
 *  (fixed candidate list) would never find. */
export function registerSystemFontsIpc() {
  ipcMain.handle("fonts:list", async () => {
    try {
      const entries = await fontList.getFonts();
      const names = new Set<string>();
      for (const entry of entries) {
        // Entries look like `"Segoe UI" (TrueType)` / `Arial Bold`; keep the
        // family part only, drop style suffixes and surrounding quotes.
        const family = entry
          .replace(/\s*\(.*\)$/, "")
          .trim()
          .replace(/^"|"$/g, "")
          .trim();
        if (family) names.add(family);
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  });
}