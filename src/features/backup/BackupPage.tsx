import { useState } from "react";
import { HardDriveDownload, HardDriveUpload, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/Button/Button";
import { Card } from "../../components/ui/Card/Card";
import { Modal } from "../../components/ui/Modal/Modal";
import styles from "./BackupPage.module.css";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function BackupPage() {
  const [createStatus, setCreateStatus] = useState<Status>({ kind: "idle" });
  const [restoreStatus, setRestoreStatus] = useState<Status>({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleCreate = async () => {
    setCreateStatus({ kind: "busy", label: "Creating backup…" });
    const result = await window.readlynx?.backup.create();
    if (!result) {
      setCreateStatus({ kind: "idle" });
      return;
    }
    setCreateStatus(
      result.ok && result.path
        ? { kind: "done", message: `Backup saved to ${result.path}` }
        : { kind: "error", message: result.error ?? "Creating the backup failed." },
    );
  };

  const handleRestore = async () => {
    setConfirmOpen(false);
    setRestoring(true);
    setRestoreStatus({ kind: "busy", label: "Restoring backup…" });
    const result = await window.readlynx?.backup.restore();
    if (!result) {
      setRestoring(false);
      setRestoreStatus({ kind: "idle" });
      return;
    }
    if (result.ok) {
      // The database file was swapped under the running app — reload the
      // renderer so every view re-reads the restored library.
      window.location.reload();
      return;
    }
    setRestoring(false);
    setRestoreStatus({ kind: "error", message: result.error ?? "Restoring the backup failed." });
  };

  return (
    <main className={styles.page} aria-label="Backup and restore">
      <div className={styles.intro}>
        <h1 className={styles.title}>Backup &amp; Restore</h1>
        <p className={styles.subtitle}>
          Save your library to a single file, or bring a previous backup back.
        </p>
      </div>

      <div className={styles.grid}>
        <Card variant="glass" className={styles.card}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HardDriveDownload size={20} strokeWidth={1.8} />
          </span>
          <h2 className={styles.cardTitle}>Create backup</h2>
          <p className={styles.cardDesc}>
            Write a snapshot of your whole library — books, documents, covers,
            translations, reading progress and AI models — into one .zip file.
          </p>
          {createStatus.kind === "busy" ? (
            <span className={styles.status} role="status">
              <Loader2 size={15} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
              {createStatus.label}
            </span>
          ) : (
            <Button onClick={() => void handleCreate()}>Create backup</Button>
          )}
          {createStatus.kind === "done" && (
            <span className={`${styles.status} ${styles.statusDone}`} role="status">
              {createStatus.message}
            </span>
          )}
          {createStatus.kind === "error" && (
            <span className={`${styles.status} ${styles.statusError}`} role="alert">
              {createStatus.message}
            </span>
          )}
        </Card>

        <Card variant="glass" className={styles.card}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HardDriveUpload size={20} strokeWidth={1.8} />
          </span>
          <h2 className={styles.cardTitle}>Restore backup</h2>
          <p className={styles.cardDesc}>
            Replace the current library with a previously saved backup. Everything
            in the current library is overwritten and cannot be recovered.
          </p>
          {restoreStatus.kind === "busy" ? (
            <span className={styles.status} role="status">
              <Loader2 size={15} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
              {restoreStatus.label}
            </span>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={restoring}>
              Restore backup
            </Button>
          )}
          {restoreStatus.kind === "done" && (
            <span className={`${styles.status} ${styles.statusDone}`} role="status">
              {restoreStatus.message}
            </span>
          )}
          {restoreStatus.kind === "error" && (
            <span className={`${styles.status} ${styles.statusError}`} role="alert">
              {restoreStatus.message}
            </span>
          )}
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Restore backup?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleRestore()}>
              Restore
            </Button>
          </>
        }
      >
        <p className={styles.confirmText}>
          Your current library — books, documents, covers, translations and
          settings — will be permanently replaced with the backup. This cannot
          be undone. The app will reload after the restore.
        </p>
      </Modal>
    </main>
  );
}