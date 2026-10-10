import { useEffect, useState } from "react";

/** Viewport width below which the reading-view translation toolbar stops
 *  laying its settings out inline and folds them into a dropdown.
 *
 *  A viewport breakpoint rather than a measurement of the toolbar itself: the
 *  header has to be measured before it can be laid out, and the sidebar that
 *  takes the rest of the width is a fixed 272px (80px collapsed), so the
 *  viewport predicts the available space well enough for a single threshold.
 *  Past this point the settings row no longer fits beside the title and would
 *  wrap onto extra header rows, costing reading height for controls nobody is
 *  looking at. */
const COLLAPSE_QUERY = "(max-width: 1180px)";

/** True while the viewport is narrower than the collapse threshold. The
 *  settings then live behind one button, while the Translate and
 *  Manage / Export actions stay on the bar where they are always one click
 *  away. */
export function useToolbarCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(COLLAPSE_QUERY).matches);

  useEffect(() => {
    const list = window.matchMedia(COLLAPSE_QUERY);
    const onChange = () => setCollapsed(list.matches);
    // The list is re-read on mount so the initial guess (taken before the
    // listener existed) cannot disagree with the viewport it is still on.
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  return collapsed;
}