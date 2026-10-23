import { useCallback, useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Card } from "../../../components/ui/Card/Card";
import { Select } from "../../../components/ui/Select/Select";
import { clampUiScale, UI_SCALE_DEFAULT } from "../../../shared/uiScale";
import type { SelectOption } from "../../../components/ui/Select/Select";
import styles from "./display.module.css";

/** The steps the Display card offers. Deliberately coarse: a handful of
 *  well-spaced sizes keep the choice legible, and anything finer is what the
 *  window's own zoom of PDF/EPUB pages is for. */
const SCALE_OPTIONS: number[] = [75, 90, 100, 110, 125, 150, 175, 200];

const OPTIONS: SelectOption[] = SCALE_OPTIONS.map((percent) => ({
  value: String(percent),
  label: `${percent}%`,
}));

/** Interface scale: one value for the whole app, each window included. The
 *  main process applies it with page zoom before first paint, so readers and
 *  EPUB/fonts scale truly rather than leaving the pixel-heavy parts (icons,
 *  PDF canvases, EPUB layouts) behind. */
export function DisplayCard() {
  const [scale, setScale] = useState(UI_SCALE_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void window.readlynx?.db
      .getAppSettings()
      .then((settings) => {
        if (cancelled || !settings) return;
        setScale(clampUiScale(settings.uiScale));
      })
      .catch(() => {
        // No bridge / worker down — the default is already on display.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setScaleValue = useCallback((percent: number) => {
    setScale(percent);
    void window.readlynx?.db.updateAppSettings({ uiScale: percent }).catch(() => false);
    void window.readlynx?.windowControls?.setUiScale(percent).catch(() => false);
  }, []);

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <Maximize2 size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>Display</h2>
        </div>
        <p className={styles.sectionDesc}>
          Scales everything: text, icons, and the PDF/EPUB readers alike. Applied instantly to
          every open window — including reader windows — and remembered for the next launch.
        </p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Interface scale</span>
          <span className={styles.rowDesc}>100% is the native size; larger values trade
            visible area for bigger, more comfortable controls.</span>
        </div>
        <Select
          className={styles.scaleSelect}
          options={OPTIONS}
          value={String(scale)}
          onChange={(event) => setScaleValue(clampUiScale(Number(event.target.value)))}
          aria-label="Interface scale"
        />
      </div>
    </Card>
  );
}
