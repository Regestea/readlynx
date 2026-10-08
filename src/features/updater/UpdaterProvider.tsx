import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useToast } from "../../components/ui/Toast/ToastContext";
import { UpdaterContext } from "./UpdaterContext";
import type { UpdateCheckState, UpdateInstallPhase, UpdaterController } from "./UpdaterContext";
import type { UpdateProgress } from "../../shared/updater";
import { UpdateDialog } from "./UpdateDialog";

/** The startup check waits for the window to settle first — a network round
 *  trip in the opening seconds would hold up the library — and then repeats
 *  every six hours for sessions that stay open. */
const STARTUP_DELAY_MS = 4000;
const REPEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Owns the self-update state for the whole app: the sidebar button, the dialog
 *  and the Settings card all read the same check instead of polling GitHub
 *  once each. Mounted inside `ToastProvider` (it raises toasts) and outside
 *  `ThemeProvider`'s consumers. */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [check, setCheck] = useState<UpdateCheckState>({ kind: "idle" });
  const [phase, setPhase] = useState<UpdateInstallPhase | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  /** Guards against overlapping checks/installs: the guard is a ref, not the
   *  `phase` state, so the callbacks below stay stable. */
  const busyRef = useRef(false);

  useEffect(() => {
    return window.readlynx?.updater.onProgress((next) => {
      setPhase(next.phase);
      setProgress(next);
    });
  }, []);

  const checkNow = useCallback(
    async (options?: { silent?: boolean }) => {
      const bridge = window.readlynx?.updater;
      if (!bridge || busyRef.current) return;
      const silent = options?.silent ?? false;
      busyRef.current = true;
      if (!silent) setCheck({ kind: "checking" });
      try {
        const result = await bridge.check();
        setCheck({ kind: "done", result });
        if (!silent && !result.disabled && result.updateAvailable && result.asset) {
          toast.info(`ReadLynx ${result.latestVersion} is available.`);
        }
      } catch (error) {
        // A silent check keeps whatever the last one reported: a background
        // poll that fails must not turn a "you're up to date" answer into an
        // error the user has to look at.
        if (silent) return;
        const reason = error instanceof Error ? error.message : "Checking for updates failed.";
        setCheck({ kind: "error", message: reason });
        toast.error(reason);
      } finally {
        busyRef.current = false;
      }
    },
    [toast],
  );

  const install = useCallback(async () => {
    const bridge = window.readlynx?.updater;
    if (!bridge || busyRef.current) return;
    busyRef.current = true;
    setMessage(null);
    setProgress(null);
    try {
      const outcome = await bridge.install();
      if (!outcome.ok) {
        setPhase(null);
        toast.error(outcome.error ?? "Installing the update failed.");
        return;
      }
      setMessage(outcome.message);
      if (outcome.restarting) {
        // The app is quitting to let the installer replace its files, so the
        // dialog has nothing left to say.
        setDialogOpen(false);
        toast.success(outcome.message || "ReadLynx is updating.");
      } else {
        // Handed over to the user (a .deb, or an AppImage the wrapper hid):
        // the pipeline is over, so the buttons come back and the dialog only
        // has the "here is the file" message left to show.
        setPhase(null);
      }
    } catch (error) {
      setPhase(null);
      toast.error(error instanceof Error ? error.message : "Installing the update failed.");
    } finally {
      busyRef.current = false;
    }
  }, [toast]);

  const cancel = useCallback(() => {
    void window.readlynx?.updater.cancel();
    setPhase(null);
    setProgress(null);
  }, []);

  const openReleases = useCallback(() => {
    void window.readlynx?.updater.openReleases();
  }, []);

  useEffect(() => {
    if (!window.readlynx?.updater) return;
    const startup = window.setTimeout(() => void checkNow({ silent: true }), STARTUP_DELAY_MS);
    const repeat = window.setInterval(
      () => void checkNow({ silent: true }),
      REPEAT_INTERVAL_MS,
    );
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(repeat);
    };
  }, [checkNow]);

  const value = useMemo<UpdaterController>(
    () => ({
      check,
      hasUpdate: check.kind === "done" && check.result.updateAvailable,
      phase,
      progress,
      message,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
      checkNow,
      install,
      cancel,
      openReleases,
    }),
    [check, phase, progress, message, dialogOpen, checkNow, install, cancel, openReleases],
  );

  return (
    <UpdaterContext.Provider value={value}>
      {children}
      <UpdateDialog />
    </UpdaterContext.Provider>
  );
}