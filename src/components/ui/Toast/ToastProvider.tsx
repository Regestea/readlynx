import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ToastContext } from "./ToastContext";
import type { ToastOptions, ToastVariant } from "./ToastContext";
import styles from "./Toast.module.css";

/** Fade-out time; the item is removed from the list once it has played. */
const EXIT_MS = 180;
/** Newer toasts push the oldest ones out of the stack. */
const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 4500;
/** Failures stay up longer — they usually have to be read and acted on. */
const ERROR_DURATION = 8000;
/** Shortest a paused toast waits before it closes again, so a quick hover
 *  never makes it disappear right after the pointer leaves. */
const MIN_REMAINING = 900;

const ICONS: Record<ToastVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: styles.toastInfo,
  success: styles.toastSuccess,
  error: styles.toastError,
};

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  /** True while the pointer is over the toast: its timer is on hold. */
  paused: boolean;
  /** True while the exit animation plays. */
  leaving: boolean;
}

/** App-wide notification stack. Mounted once at the app root; the portal
 *  keeps the stack out of any page layout (and out of the `overflow: hidden`
 *  containers the readers use) and above every dialog, so a message raised
 *  while a modal is open is still seen. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  /** Authoritative list: `show` / `dismiss` / `pause` need the current items
   *  synchronously, outside a state updater (updaters must stay pure). */
  const itemsRef = useRef<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, number>());
  const startedRef = useRef(new Map<string, number>());
  const remainingRef = useRef(new Map<string, number>());

  const commit = useCallback((next: ToastItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      commit(
        itemsRef.current.map((item) =>
          item.id === id ? { ...item, leaving: true, paused: true } : item,
        ),
      );
    },
    [clearTimer, commit],
  );

  /** (Re)starts a toast's countdown. `duration: 0` keeps it until dismissed
   *  by hand, so no timer is armed at all. */
  const arm = useCallback(
    (id: string, duration: number) => {
      clearTimer(id);
      remainingRef.current.set(id, duration);
      if (duration <= 0) return;
      startedRef.current.set(id, Date.now());
      timersRef.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration),
      );
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (message: string, options: ToastOptions = {}): string => {
      const text = message.trim();
      if (!text) return "";
      const variant = options.variant ?? "info";
      const duration =
        options.duration ??
        (variant === "error" ? ERROR_DURATION : DEFAULT_DURATION);
      const current = itemsRef.current;
      // The same message twice in a row is one event, not two: restart the
      // toast that is already on screen.
      const existing = current.find(
        (item) => item.message === text && item.variant === variant,
      );
      if (existing) {
        commit(
          current.map((item) =>
            item.id === existing.id
              ? { ...item, duration, leaving: false }
              : item,
          ),
        );
        // A toast the pointer is resting on keeps its paused countdown; one
        // that was already dismissing (its timer was cleared) restarts.
        if (timersRef.current.has(existing.id)) arm(existing.id, duration);
        return existing.id;
      }
      const id = crypto.randomUUID();
      // A dismissed toast must not count against the visible limit.
      const kept = current.filter((item) => !item.leaving);
      const next = [
        ...kept,
        { id, message: text, variant, duration, paused: false, leaving: false },
      ];
      const overflow = next.slice(Math.max(0, next.length - MAX_VISIBLE));
      for (const item of overflow) clearTimer(item.id);
      commit(overflow);
      arm(id, duration);
      return id;
    },
    [arm, clearTimer, commit],
  );

  /** Hovering a toast holds its countdown, so a long message can be read
   *  without racing the timer. */
  const pause = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timersRef.current.delete(id);
      const elapsed = Date.now() - (startedRef.current.get(id) ?? Date.now());
      remainingRef.current.set(
        id,
        Math.max(MIN_REMAINING, (remainingRef.current.get(id) ?? 0) - elapsed),
      );
      commit(
        itemsRef.current.map((item) =>
          item.id === id ? { ...item, paused: true } : item,
        ),
      );
    },
    [commit],
  );

  const resume = useCallback(
    (id: string) => {
      if (timersRef.current.get(id) !== undefined) return;
      arm(id, remainingRef.current.get(id) ?? DEFAULT_DURATION);
      commit(
        itemsRef.current.map((item) =>
          item.id === id ? { ...item, paused: false } : item,
        ),
      );
    },
    [arm, commit],
  );

  /** Drops the items whose exit animation has played. */
  useEffect(() => {
    if (!items.some((item) => item.leaving)) return;
    const timer = window.setTimeout(() => {
      const kept = itemsRef.current.filter((item) => !item.leaving);
      for (const item of itemsRef.current) {
        if (kept.includes(item)) continue;
        clearTimer(item.id);
        startedRef.current.delete(item.id);
        remainingRef.current.delete(item.id);
      }
      commit(kept);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [items, clearTimer, commit]);

  /** No timer may outlive the provider (app quit, fast refresh). */
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      show,
      info: (message: string) => show(message, { variant: "info" }),
      success: (message: string) => show(message, { variant: "success" }),
      error: (message: string) => show(message, { variant: "error" }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className={styles.stack} role="region" aria-label="Notifications">
          {items.map((item) => {
            const Icon = ICONS[item.variant];
            return (
              <div
                key={item.id}
                className={`${styles.toast} ${VARIANT_CLASSES[item.variant]} ${item.leaving ? styles.toastLeaving : ""}`}
                role={item.variant === "error" ? "alert" : "status"}
                onMouseEnter={() => pause(item.id)}
                onMouseLeave={() => resume(item.id)}
              >
                <span className={styles.icon} aria-hidden="true">
                  <Icon size={15} strokeWidth={2} />
                </span>
                <span className={styles.message}>{item.message}</span>
                <button
                  type="button"
                  className={styles.close}
                  onClick={() => dismiss(item.id)}
                  aria-label="Dismiss notification"
                  title="Dismiss"
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                {item.duration > 0 && (
                  <span
                    className={styles.timer}
                    aria-hidden="true"
                    style={{
                      animationDuration: `${item.duration}ms`,
                      animationPlayState: item.paused ? "paused" : "running",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
