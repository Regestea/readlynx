import { createContext, useContext } from "react";

export type ToastVariant = "info" | "success" | "error";

export interface ToastOptions {
  /** `error` reads as a failure, `success` as a finished job, `info` neutral. */
  variant?: ToastVariant;
  /** Milliseconds before the toast closes itself. `0` keeps it until it is
   *  dismissed by hand. Defaults to 4.5s (8s for `error`, which usually has
   *  to be read carefully). */
  duration?: number;
}

export interface ToastContextValue {
  /** Shows a toast and returns its id (hand it to `dismiss` to close it
   *  early). Showing a message that is already on screen restarts that
   *  toast's timer instead of stacking a second copy. */
  show: (message: string, options?: ToastOptions) => string;
  info: (message: string) => string;
  success: (message: string) => string;
  error: (message: string) => string;
  /** Closes a toast with its exit animation. */
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
