import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Modal } from "../../../../components/ui/Modal/Modal";
import { Button } from "../../../../components/ui/Button/Button";
import { NumberInput } from "../../../../components/ui/NumberInput/NumberInput";
import { formatMinutes } from "../../../../shared/utils";
import styles from "./ReadingGoalModal.module.css";

const MIN_GOAL = 5;
const MAX_GOAL = 600;

/** Formats the goal minutes like a stopwatch reading: 45 → "0:45", 90 →
 *  "1:30", 600 → "10:00". */
function formatGoal(goalMinutes: number): string {
  const hours = Math.floor(goalMinutes / 60);
  const minutes = String(goalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

interface ReadingGoalModalProps {
  open: boolean;
  initialMinutes: number;
  /** Minutes read so far today — shown under the watch. */
  todayMinutes: number;
  onClose: () => void;
  onSaved: (minutes: number) => void;
}

export function ReadingGoalModal({
  open,
  initialMinutes,
  todayMinutes,
  onClose,
  onSaved,
}: ReadingGoalModalProps) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [saving, setSaving] = useState(false);

  // Re-sync the draft with the saved goal every time the modal opens (or the
  // saved goal changes while open) — adjusted during render, per React's
  // "derive state from props" guidance.
  const [lastSync, setLastSync] = useState({ open: false, initialMinutes });
  if (open && (lastSync.open !== open || lastSync.initialMinutes !== initialMinutes)) {
    setLastSync({ open, initialMinutes });
    setMinutes(initialMinutes);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await window.readlynx?.db.setDailyGoal(minutes);
      onSaved(saved?.goalMinutes ?? minutes);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const pctOfGoal = minutes > 0 ? Math.round((todayMinutes / minutes) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Daily Reading Goal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            Save Goal
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.watch}>
          <svg
            className={styles.watchSvg}
            viewBox="0 0 220 220"
            role="img"
            aria-label={`Daily reading goal of ${formatMinutes(minutes)}`}
          >
            <circle className={styles.bezel} cx="110" cy="110" r="103" />
            <circle className={styles.face} cx="110" cy="110" r="93" />
            {Array.from({ length: 60 }, (_, i) => {
              const major = i % 5 === 0;
              const angle = (i * 6 * Math.PI) / 180;
              const inner = major ? 80 : 85;
              return (
                <line
                  key={i}
                  className={major ? styles.tickMajor : styles.tickMinor}
                  x1={110 + inner * Math.sin(angle)}
                  y1={110 - inner * Math.cos(angle)}
                  x2={110 + 92 * Math.sin(angle)}
                  y2={110 - 92 * Math.cos(angle)}
                />
              );
            })}
          </svg>
          <div className={styles.readout}>
            <strong className={styles.readoutTime}>{formatGoal(minutes)}</strong>
            <span className={styles.readoutCaption}>goal · minutes</span>
          </div>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => setMinutes((value) => Math.max(MIN_GOAL, value - 15))}
            aria-label="Decrease goal by 15 minutes"
          >
            <Minus size={14} strokeWidth={2.4} aria-hidden="true" />
            15
          </button>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => setMinutes((value) => Math.max(MIN_GOAL, value - 5))}
            aria-label="Decrease goal by 5 minutes"
          >
            <Minus size={14} strokeWidth={2.4} aria-hidden="true" />
            5
          </button>
          <NumberInput
            value={minutes}
            onChange={setMinutes}
            min={MIN_GOAL}
            max={MAX_GOAL}
            step={5}
            label="Daily goal in minutes"
          />
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => setMinutes((value) => Math.min(MAX_GOAL, value + 5))}
            aria-label="Increase goal by 5 minutes"
          >
            <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
            5
          </button>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => setMinutes((value) => Math.min(MAX_GOAL, value + 15))}
            aria-label="Increase goal by 15 minutes"
          >
            <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
            15
          </button>
        </div>

        <p className={styles.hint}>
          You&apos;ve read <strong>{formatMinutes(todayMinutes)}</strong> today
          {todayMinutes > 0 && minutes > 0 ? (
            <>
              {" "}
              — <strong>{pctOfGoal}%</strong> of this goal
            </>
          ) : null}
          .
        </p>
      </div>
    </Modal>
  );
}