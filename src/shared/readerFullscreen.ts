import { useSyncExternalStore } from "react";

/** Layout-level "a reader is fullscreen" flag, shared by every fullscreen
 *  reader (PDF, EPUB, Markdown, document editor).
 *
 *  The viewers each paint their own overlay, but the app chrome around them —
 *  the custom title bar, the sidebar, the stats panel, the reading page's top
 *  bar — belongs to the shell, which cannot see inside a viewer. Without a
 *  shared flag the shell can never get out of the way, so "fullscreen" always
 *  kept a 36px title bar (and the sidebar gutter) on screen: maximise with a
 *  bigger page, not fullscreen. Counting rather than boolean, so two
 *  enter/exit pairs can never wedge the shell chromeless.
 *
 *  Escape layering is deliberately NOT handled here: popovers (theme, colors,
 *  OCR, export, font list, image view) each close themselves on Escape, and
 *  every fullscreen reader yields to an open one — see `POPOVER_ROLES`. The
 *  topmost layer always eats the key first, exactly like the reading page's
 *  arrow-key guard (`ReadingPage.tsx`) already does for dialogs.
 */

let count = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Roles of floating layers that eat an Escape before fullscreen may. Every
 *  one of them closes itself on Escape, so yielding can never trap the key. */
export const POPOVER_ROLES = '[role="dialog"], [role="menu"], [role="listbox"]';

/** True while an open popover should eat an Escape instead of fullscreen. */
export function popoverOpen(): boolean {
  return document.querySelector(POPOVER_ROLES) !== null;
}

export function enterReaderFullscreen(): void {
  count += 1;
  notify();
}

export function exitReaderFullscreen(): void {
  count = Math.max(0, count - 1);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any reader is fullscreen. The shell hides its chrome on it. */
export function useReaderFullscreen(): boolean {
  return useSyncExternalStore(subscribe, () => count > 0);
}
