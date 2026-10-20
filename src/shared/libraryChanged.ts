import { useEffect, useRef } from "react";

/** The shelf lives inside the library tab, and every tab keeps its page
 *  mounted, so writes that happen outside it — a silent "Open with" import,
 *  a promotion of a session copy, cover capture — never reach whatever the
 *  shelf has already loaded, and it stays stale until the app restarts.
 *  This registry lets those writers say "the library may have changed"
 *  once; the shelf is the only listener and it simply re-runs its load. */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Announces that the library may have changed. Firing it when nothing did
 *  is harmless: listeners just repeat a cheap list query. */
export function notifyLibraryChanged(): void {
  for (const listener of listeners) listener();
}

/** Registers `listener` until unmount. The latest identity rides in a ref
 *  so frequent re-registrations do not churn the set. */
export function useLibraryChanged(listener: Listener): void {
  const listenerRef = useRef(listener);
  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);
  useEffect(() => {
    const handler = () => listenerRef.current();
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
}
