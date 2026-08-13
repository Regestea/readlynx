import { useEffect, useRef } from "react";

type CloseFlush = () => Promise<void>;

/** The single page that may hold unsaved work when the window closes (the
 *  create-book editor or the reading view). Registering `null` clears it. */
let currentFlush: CloseFlush | null = null;

export function registerCloseFlush(flush: CloseFlush | null): void {
  currentFlush = flush;
}

export function getCloseFlush(): CloseFlush | null {
  return currentFlush;
}

/** Registers a function that runs when the window is about to close, so
 *  pending saves finish before the app quits — the same work the page's
 *  top-bar back button performs. */
export function useCloseFlush(flush: CloseFlush): void {
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    registerCloseFlush(() => flushRef.current());
    return () => registerCloseFlush(null);
  }, []);
}