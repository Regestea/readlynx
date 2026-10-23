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

/** Per-tab copies of the same save, keyed by the tab id App passes down.
 *  The map only ever holds entries for tabs that are actually in the bar —
 *  the page removes its entry when it unmounts, so a reopened tab registers
 *  fresh. */
const tabFlushes = new Map<string, CloseFlush>();

export function registerTabFlush(tabId: string, flush: CloseFlush | null): void {
  if (flush) tabFlushes.set(tabId, flush);
  else tabFlushes.delete(tabId);
}

export function getTabFlush(tabId: string): CloseFlush | undefined {
  return tabFlushes.get(tabId);
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

/** Registers a function that runs before the page's tab is closed. The hook
 *  exists because closing a tab unmounts the page, and React nulls a
 *  component's refs *before* its unmount cleanups run — a save written at
 *  that point cannot reach into the editor or the live viewer anymore. App
 *  code flushes through this while the page is still fully interactive. */
export function useTabFlush(tabId: string | undefined, flush: CloseFlush): void {
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    if (!tabId) return;
    registerTabFlush(tabId, () => flushRef.current());
    return () => registerTabFlush(tabId, null);
  }, [tabId]);
}