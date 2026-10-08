import { createContext, useContext } from "react";
import type { UpdateCheckResult, UpdateProgress } from "../../shared/updater";

/** State of the last release check. */
export type UpdateCheckState =
  /** Nothing asked GitHub yet. */
  | { kind: "idle" }
  | { kind: "checking" }
  /** GitHub answered — `result.updateAvailable` decides what the UI offers. */
  | { kind: "done"; result: UpdateCheckResult }
  | { kind: "error"; message: string };

/** The install pipeline step in flight, or null while nothing is running. */
export type UpdateInstallPhase = "downloading" | "verifying" | "installing";

export interface UpdaterController {
  check: UpdateCheckState;
  /** True when the newest release is newer than the running build. */
  hasUpdate: boolean;
  phase: UpdateInstallPhase | null;
  progress: UpdateProgress | null;
  /** Outcome of a finished install, shown in the dialog. */
  message: string | null;
  dialogOpen: boolean;
  openDialog(): void;
  closeDialog(): void;
  /** Re-runs the check. `silent` keeps a failure off the screen — used for the
   *  startup and interval checks, which must never interrupt the user. */
  checkNow(options?: { silent?: boolean }): Promise<void>;
  /** Downloads, verifies and installs the build the last check picked. */
  install(): Promise<void>;
  /** Aborts the running download. */
  cancel(): void;
  /** Opens the release page in the system browser. */
  openReleases(): void;
}

export const UpdaterContext = createContext<UpdaterController | null>(null);

export function useUpdater(): UpdaterController {
  const context = useContext(UpdaterContext);
  if (!context) {
    throw new Error("useUpdater must be used within an UpdaterProvider");
  }
  return context;
}