import { ArrowUp, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button/Button";
import { Card } from "../../components/ui/Card/Card";
import { Progress } from "../../components/ui/Progress/Progress";
import { formatBytes } from "../../shared/utils";
import { useUpdater } from "../updater/UpdaterContext";
import styles from "./updates.module.css";

/** Manual counterpart to the sidebar button: the current version, the last
 *  answer from GitHub, and a way to install without hunting for the sidebar. */
export function UpdatesSection() {
  const { check, hasUpdate, phase, progress, openDialog, checkNow } = useUpdater();

  const result = check.kind === "done" ? check.result : null;
  const busy = phase !== null;
  const update = hasUpdate ? result : null;

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <RefreshCw size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>Updates</h2>
        </div>
        <p className={styles.sectionDesc}>
          New ReadLynx builds are published on the project&apos;s GitHub releases. When one shows
          up you can download and install it straight from here — your library and settings are
          kept.
        </p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>
            {result ? `Version ${result.currentVersion}` : "Version"}
          </span>
          <span className={styles.rowStatus} role="status">
            {check.kind === "checking" && "Checking for updates…"}
            {check.kind === "error" && (
              <span className={styles.rowError}>
                <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
                {check.message}
              </span>
            )}
            {check.kind === "done" && update && `Version ${update.latestVersion} is available.`}
            {check.kind === "done" && !update && "You are on the latest version."}
            {check.kind === "idle" && "No check has run yet."}
          </span>
        </div>

        {busy ? (
          <Button disabled>
            {phase === "downloading" && (
              <>
                <Loader2 size={16} strokeWidth={1.8} className={styles.spinner} aria-hidden="true" />
                {progress?.fraction === null || !progress
                  ? "Working…"
                  : `Downloading ${Math.round(progress.fraction * 100)}%`}
              </>
            )}
            {phase === "verifying" && "Verifying…"}
            {phase === "installing" && "Installing…"}
          </Button>
        ) : update ? (
          <Button onClick={openDialog}>
            <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" />
            Install update
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => void checkNow()}
            disabled={check.kind === "checking"}
          >
            <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />
            Check for updates
          </Button>
        )}
      </div>

      {busy && progress?.phase === "downloading" && (
        <div className={styles.progress}>
          <Progress value={progress.fraction ?? 0} />
          <span className={styles.progressMeta}>
            {formatBytes(progress.received)} of {formatBytes(progress.total)}
          </span>
        </div>
      )}

      {update?.asset && !busy && (
        <span className={styles.asset}>
          {update.asset.name} · {formatBytes(update.asset.size)} for {update.platform}
        </span>
      )}
    </Card>
  );
}