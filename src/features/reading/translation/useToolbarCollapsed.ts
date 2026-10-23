import { useLayoutEffect, useRef, useState } from "react";

/** Decides whether the reading-view translation toolbar folds its settings
 *  into a dropdown — by measuring the real fit, not by guessing from the
 *  viewport. A hidden, never-wrapping copy of the full inline row (settings
 *  plus both action buttons) is compared against the width of the header row
 *  the toolbar would occupy; the settings collapse only when that row alone
 *  cannot hold everything on a single line.
 *
 *  A viewport breakpoint cannot make that call: the sidebar (272 / 80 / 0px),
 *  the missing chrome of a reader window, the book format (PDF shows four
 *  more controls than EPUB) and the label lengths (model names, OCR language
 *  summaries) all move the real available width around at any window size —
 *  and the interface scale (`webContents.setZoomFactor`) resizes everything
 *  at once. Measuring both sides in the same units keeps the decision
 *  correct under zoom and requires no pixel constants.
 *
 *  The probe is `position: fixed` and `visibility: hidden`, so it never
 *  joins the layout, never paints, cannot be focused and cannot add
 *  scrollbars; its width is `max-content`, i.e. exactly what the inline row
 *  would need to stay on one line. */
export function useToolbarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);

  // Layout effect so the first decision lands before the first paint — a
  // narrow window never flashes the expanded row and then collapses it.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const probe = probeRef.current;
    if (!toolbar || !probe) return;
    // The header row that hosts the toolbar. When the bar gets too wide the
    // toolbar wraps onto its own full-width row (the title yields first, see
    // the topBar styles), so the space to compare against is the whole
    // header content box — not the slice the toolbar happens to sit on
    // beside the title right now.
    const row = toolbar.closest("header") ?? toolbar.parentElement;
    if (!row) return;
    const rowStyle = getComputedStyle(row);
    const measure = () => {
      const available =
        row.getBoundingClientRect().width -
        parseFloat(rowStyle.paddingLeft) -
        parseFloat(rowStyle.paddingRight) -
        parseFloat(rowStyle.borderLeftWidth) -
        parseFloat(rowStyle.borderRightWidth);
      setCollapsed(probe.getBoundingClientRect().width > available);
    };
    measure();
    // ResizeObserver rather than a window resize listener: collapsing the
    // sidebar animates the header wider without any window event, the zoom
    // factor resizes every box at once, and a settings change (model picked,
    // OCR languages) or a late font swap resizes the probe itself. None of
    // those depend on the collapsed state, so the decision cannot oscillate.
    const observer = new ResizeObserver(() => measure());
    observer.observe(probe);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return { collapsed, toolbarRef, probeRef };
}
