import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Languages,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import type { SelectionTranslationResult } from "../../shared/selectionTranslation.ts";
import styles from "./SelectionTranslation.module.css";

interface SelectionTranslationActionProps {
  /** Viewport coords for the circle (at the start of the selection). */
  x: number;
  y: number;
  /** Human-readable output language, used in the tooltip. */
  label: string;
  onOpen: () => void;
}

/** Circular "translate" button that floats at the start of a text selection.
 *  Mirrors the AI bubble at the selection's end, in the terracotta accent. */
export function SelectionTranslationAction({
  x,
  y,
  label,
  onOpen,
}: SelectionTranslationActionProps) {
  const description = label ? `Translate selection to ${label}` : "Translate selection";
  return (
    <button
      type="button"
      data-selection-translation-action=""
      className={styles.action}
      style={{ left: x, top: y }}
      title={description}
      aria-label={description}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      <Languages size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

interface SelectionTranslationPanelProps {
  /** Viewport coords of the circle that opened the panel. */
  x: number;
  y: number;
  /** Text selected in the book. */
  text: string;
  /** Human-readable output language for the header. */
  label: string;
  onTranslate: (text: string) => Promise<SelectionTranslationResult>;
  onClose: () => void;
}

type PanelState =
  | { status: "loading" }
  | { status: "done"; result: SelectionTranslationResult }
  | { status: "error"; message: string };

const PANEL_GAP = 10;
const VIEWPORT_MARGIN = 8;
const ACTION_SIZE = 40;

/** Small floating result box opened from {@link SelectionTranslationAction}.
 *  It owns its open/request state for as long as the host keeps it mounted, so
 *  selecting or copying text inside the box (which clears the book's own
 *  selection) never unmounts it. */
export function SelectionTranslationPanel({
  x,
  y,
  text,
  label,
  onTranslate,
  onClose,
}: SelectionTranslationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const requestRef = useRef(0);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const translateRef = useRef(onTranslate);

  useEffect(() => {
    translateRef.current = onTranslate;
  }, [onTranslate]);

  const run = useCallback(() => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState({ status: "loading" });
    setCopied(false);
    void translateRef.current(text).then(
      (result) => {
        if (requestRef.current === request) setState({ status: "done", result });
      },
      (error: unknown) => {
        if (requestRef.current !== request) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }, [text]);

  useEffect(() => {
    // Defer past the commit boundary: `run` sets the loading state, and doing
    // that synchronously inside the effect would cascade another render.
    const timer = window.setTimeout(run, 0);
    return () => {
      window.clearTimeout(timer);
      // Any response still in flight belongs to a closed panel.
      requestRef.current += 1;
    };
  }, [run]);

  useEffect(() => () => {
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
  }, []);

  /** Places the box under the circle, flipping above it when the viewport
   *  bottom is close, then clamps it inside the window. Measured after render
   *  because the result and the error states have different heights. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, x + ACTION_SIZE / 2 - rect.width / 2),
        maxLeft,
      );
      const below = y + ACTION_SIZE + PANEL_GAP;
      const top =
        below + rect.height <= window.innerHeight - VIEWPORT_MARGIN
          ? below
          : Math.min(Math.max(VIEWPORT_MARGIN, y - rect.height - PANEL_GAP), maxTop);
      setPosition({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [x, y]);

  useEffect(() => {
    const onDocumentDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // The circle toggles/reaims the panel; closing it here would make every
      // click re-run the request after the panel remounts.
      if (target?.closest("[data-selection-translation-action]")) return;
      if (!panelRef.current?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const copy = async () => {
    if (state.status !== "done") return;
    const copied = await window.readlynx?.clipboard.writeText(state.result.text).catch(() => false);
    if (!copied) return;
    setCopied(true);
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const title = label ? `Translate to ${label}` : "Translation";
  const provider =
    state.status === "done"
      ? state.result.provider === "google"
        ? "Google Translate"
        : "AI"
      : null;

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={
        position
          ? { left: position.left, top: position.top }
          : { left: x, top: y + ACTION_SIZE + PANEL_GAP, visibility: "hidden" }
      }
      role="dialog"
      aria-label="Selection translation"
    >
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <Languages size={15} strokeWidth={2} />
        </span>
        <span className={styles.title}>{title}</span>
        {provider && <span className={styles.provider}>{provider}</span>}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close translation"
          title="Close"
          onClick={onClose}
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.body}>
        {state.status === "loading" ? (
          <span className={styles.loading} role="status">
            <Loader2 size={16} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
            <span>Translating…</span>
          </span>
        ) : state.status === "error" ? (
          <span className={styles.error} role="alert">
            <AlertCircle size={15} strokeWidth={2} aria-hidden="true" />
            <span>{state.message}</span>
          </span>
        ) : (
          <p className={styles.result} dir="auto">
            {state.result.text}
          </p>
        )}
      </div>

      {state.status === "done" && (
        <footer className={styles.footer}>
          <button type="button" className={styles.footerButton} onClick={() => void copy()}>
            {copied ? (
              <Check size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </footer>
      )}
      {state.status === "error" && (
        <footer className={styles.footer}>
          <button type="button" className={styles.footerButton} onClick={run}>
            <RotateCw size={14} strokeWidth={2} aria-hidden="true" />
            <span>Retry</span>
          </button>
        </footer>
      )}
    </div>
  );
}
