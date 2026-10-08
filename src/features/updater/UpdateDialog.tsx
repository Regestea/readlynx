import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, CircleCheck, Download, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button/Button";
import { Modal } from "../../components/ui/Modal/Modal";
import { Progress } from "../../components/ui/Progress/Progress";
import { formatBytes } from "../../shared/utils";
import { useUpdater } from "./UpdaterContext";
import styles from "./UpdateDialog.module.css";

/** Release notes are Markdown written by the release job (headings, bullet
 *  lists, the install table). The plugin list must keep a stable identity or
 *  react-markdown re-parses the document on every render. */
const REMARK_PLUGINS = [remarkGfm];

/** Raw HTML is never rendered and links are handed to the main process (which
 *  only accepts github.com over https) instead of navigating the app window.
 *
 *  `table` is given the already-rendered `thead`/`tbody`, so the `<table>` has
 *  to be rebuilt here — the element the plugin produced is never handed over. */
const NOTES_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <button
      type="button"
      className={styles.noteLink}
      title={href}
      onClick={() => {
        if (href) void window.readlynx?.updater.openLink(href);
      }}
    >
      {children}
    </button>
  ),
  table: ({ children }) => (
    <div className={styles.noteTable}>
      <table>{children}</table>
    </div>
  ),
};

function formatEta(seconds: number): string {
  return seconds < 60 ? `${seconds}s left` : `${Math.ceil(seconds / 60)} min left`;
}

/** The dialog behind the sidebar's update button: what is available, what the
 *  download is doing, and the button that starts it. */
export function UpdateDialog() {
  const {
    check,
    phase,
    progress,
    message,
    dialogOpen,
    closeDialog,
    checkNow,
    install,
    cancel,
    openReleases,
  } = useUpdater();

  const result = check.kind === "done" ? check.result : null;
  const update = result?.updateAvailable ? result : null;
  /** A release with no build for this OS/arch: nothing to install, but the
   *  page is still worth opening. */
  const unsupported = update !== null && update.asset === null;
  const busy = phase !== null;

  /** Closing mid-download also stops it — there is nothing to come back to. */
  const handleClose = () => {
    if (phase === "downloading") cancel();
    closeDialog();
  };

  const title = (() => {
    if (busy) return phase === "downloading" ? "Downloading update" : "Installing update";
    if (check.kind === "error") return "Could not check for updates";
    if (result?.disabled) return "Updates";
    if (update) return "Update available";
    if (check.kind === "done") return "ReadLynx is up to date";
    return "Check for updates";
  })();

  const footer = (() => {
    if (busy) {
      return (
        <>
          {phase === "downloading" && (
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
          )}
          <Button disabled>
            {phase === "downloading"
              ? "Downloading…"
              : phase === "verifying"
                ? "Verifying…"
                : "Installing…"}
          </Button>
        </>
      );
    }
    // An unpackaged dev run never has an update to offer, so it gets no actions.
    if (result?.disabled) {
      return (
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
      );
    }
    if (check.kind === "error") {
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
          <Button onClick={() => void checkNow()}>
            <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />
            Try again
          </Button>
        </>
      );
    }
    if (unsupported) {
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
          <Button onClick={openReleases}>
            <Download size={16} strokeWidth={1.8} aria-hidden="true" />
            Open downloads
          </Button>
        </>
      );
    }
    if (update) {
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>
            Later
          </Button>
          <Button onClick={() => void install()}>
            <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" />
            Install update
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
        <Button variant={check.kind === "done" ? "secondary" : "primary"} onClick={() => void checkNow()}>
          <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />
          {check.kind === "done" ? "Check again" : "Check for updates"}
        </Button>
      </>
    );
  })();

  const notes = useMemo(() => (result?.notes.trim() ? result.notes : ""), [result]);

  return (
    <Modal open={dialogOpen} onClose={handleClose} title={title} footer={footer}>
      {check.kind === "idle" && (
        <p className={styles.lead}>
          ReadLynx looks for new versions on GitHub and installs them for you. Check now to see
          whether there is anything newer than the build you are running.
        </p>
      )}

      {check.kind === "checking" && (
        <p className={styles.lead} role="status">
          Asking GitHub for the newest ReadLynx…
        </p>
      )}

      {check.kind === "error" && (
        <>
          <p className={styles.error} role="alert">
            <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
            {check.message}
          </p>
          <p className={styles.hint}>
            You can always grab a build yourself from the project&apos;s releases page.
          </p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={openReleases}>
              <Download size={16} strokeWidth={1.8} aria-hidden="true" />
              Open downloads
            </Button>
          </div>
        </>
      )}

      {result && !update && !result.disabled && (
        <div className={styles.upToDate} role="status">
          <CircleCheck size={20} strokeWidth={1.8} aria-hidden="true" />
          <span>ReadLynx {result.currentVersion} is the newest version.</span>
        </div>
      )}

      {result?.disabled && (
        <p className={styles.hint}>
          This is an unpackaged development build, so update checks are skipped.
        </p>
      )}

      {update && (
        <>
          <div className={styles.versionRow}>
            <span className={styles.versionFrom}>{update.currentVersion}</span>
            <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.versionTo}>{update.latestVersion}</span>
          </div>

          {update.asset ? (
            <p className={styles.hint}>
              {update.asset.name} · {formatBytes(update.asset.size)} for {update.platform}
              {update.asset.sha256 ? " · checksummed" : ""}
            </p>
          ) : (
            <p className={styles.warning} role="alert">
              <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
              This release has no build for {update.platform}, so it can&apos;t be installed
              automatically.
            </p>
          )}

          {busy && progress && (
            <div className={styles.progress}>
              <div className={styles.progressRow}>
                <span className={styles.progressLabel}>
                  {progress.phase === "downloading" &&
                    `Downloading ${formatBytes(progress.received)} of ${formatBytes(progress.total)}`}
                  {progress.phase === "verifying" && "Verifying the download"}
                  {progress.phase === "installing" && "Installing"}
                </span>
                <span className={styles.progressPercent}>
                  {progress.fraction === null
                    ? ""
                    : `${Math.round(progress.fraction * 100)}%`}
                </span>
              </div>
              {progress.fraction === null ? (
                <div className={styles.indeterminate} role="progressbar" aria-label={progress.phase}>
                  <span />
                </div>
              ) : (
                <Progress value={progress.fraction} />
              )}
              {progress.phase === "downloading" && progress.etaSeconds !== null && (
                <span className={styles.progressMeta}>
                  {formatBytes(progress.bytesPerSecond)}/s ·{" "}
                  {formatEta(progress.etaSeconds)}
                </span>
              )}
            </div>
          )}

          {message && (
            <p className={styles.message} role="status">
              {message}
            </p>
          )}

          {notes && (
            <div className={styles.notes}>
              <h3 className={styles.notesTitle}>What&apos;s new</h3>
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={NOTES_COMPONENTS}>
                {notes}
              </ReactMarkdown>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}