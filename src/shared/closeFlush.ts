import { useEffect, useId, useRef } from "react";

type CloseFlush = () => Promise<void>;

/** Pages that may hold unsaved work when the window closes (the create-book
 *  editor, the reading view), keyed by a stable per-instance id. A single slot
 *  used to be enough because the pages were mutually exclusive: with several
 *  live at once — a reader tab next to an editor tab — a page registering
 *  overwrote the others, and whichever unmounted first cleared everyone's
 *  pending save. */
const flushes = new Map<string, CloseFlush>();

export function registerCloseFlush(key: string, flush: CloseFlush | null): void {
  if (flush) flushes.set(key, flush);
  else flushes.delete(key);
}

export function getCloseFlushes(): CloseFlush[] {
  return [...flushes.values()];
}

/** Registers a function that runs when the window is about to close, so
 *  pending saves finish before the app quits — the same work the page's
 *  top-bar back button performs. */
export function useCloseFlush(flush: CloseFlush): void {
  const key = useId();
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    registerCloseFlush(key, () => flushRef.current());
    return () => registerCloseFlush(key, null);
  }, [key]);
}