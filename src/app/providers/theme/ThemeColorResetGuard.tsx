import { useEffect, useRef, useState } from "react";
import type { Theme } from "../../../shared/types";
import { Button } from "../../../components/ui/Button/Button";
import { Modal } from "../../../components/ui/Modal/Modal";
import {
  describeViewers,
  notifyReaderColorsReset,
  resetReaderColorsToTheme,
} from "../../../hooks/readerDefaultsColors";
import { useTheme } from "./ThemeContext";

/** Watches for user-initiated theme switches and puts the global reader
 *  colors back to "follow the theme", then explains why with a dialog — a
 *  color picked for the old theme otherwise looks like a rendering bug.
 *
 *  Mounted once at the app root: it must react no matter which page (reader,
 *  settings, …) the theme was switched from. */
export function ThemeColorResetGuard() {
  const { theme, themeChangeCount } = useTheme();
  const [resetViewers, setResetViewers] = useState<string | null>(null);
  const previousTheme = useRef<Theme | null>(null);

  useEffect(() => {
    const previous = previousTheme.current;
    previousTheme.current = theme;
    // The first sighting is the startup value; a change that arrives without a
    // user action (DB hydration) never bumps `themeChangeCount`, so it is
    // skipped by comparing the theme itself.
    if (previous === null || previous === theme) return;
    let cancelled = false;
    void resetReaderColorsToTheme()
      .then((viewers) => {
        if (cancelled || viewers.length === 0) return;
        notifyReaderColorsReset(viewers);
        setResetViewers(describeViewers(viewers));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [theme, themeChangeCount]);

  return (
    <Modal
      open={resetViewers !== null}
      onClose={() => setResetViewers(null)}
      title="Reading colors reset"
      footer={
        <Button variant="secondary" onClick={() => setResetViewers(null)}>
          Got it
        </Button>
      }
    >
      <p>
        Reading colors are picked for one theme, and on the {theme} theme yours could end up
        unreadable — which looks like a rendering bug. The default background, text, code block and
        diagram colors of the {resetViewers} reader were reset to <strong>follow theme</strong>.
      </p>
      <p>
        Colors set for a single book are untouched. Pick them again from that book&apos;s reader
        toolbar if you want them back.
      </p>
    </Modal>
  );
}