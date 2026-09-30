import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X, ZoomIn, ZoomOut } from "lucide-react";
import { Markdown } from "../markdown/Markdown";
import { Select } from "../ui/Select/Select";
import { useAiModelList } from "../../infrastructure/ai/useAiModelList";
import type { AiModel } from "../../infrastructure/db/entities/AiModel";
import { resolveProviderBaseUrl } from "../../infrastructure/ai/modelResolver";
import styles from "./AiChatPanel.module.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatPanelProps {
  open: boolean;
  /** Text the user selected in the book; seeded into the first question. */
  contextText?: string | null;
  /** Images (data URLs) attached to the first question as vision context,
   *  e.g. a region of a PDF page. */
  contextImages?: string[];
  /** Error to show when the panel opens (e.g. click-to-ask OCR found no text). */
  initialError?: string | null;
  /** When true, the panel opens in a busy state (e.g. while click-to-ask
   *  OCRs the whole page before the seed text arrives). */
  initialBusy?: boolean;
  /** Text shown in the typing indicator while `initialBusy` is active. */
  initialBusyLabel?: string;
  onClose: () => void;
}

const SYSTEM_PROMPT = [
  "You are an AI assistant inside a reading app.",
  "The user may ask about text they selected in a book, or about any topic.",
  "Always reply in Markdown.",
  "Be helpful, accurate and concise.",
  "Mermaid diagrams are supported: render them in a fenced code block with the mermaid language (```mermaid ... ```). Pie charts are fully supported; quadrant charts are also supported if a chart fits the answer.",
].join("\n");

/** Full AI chat panel (modal): chat history lives for as long as the modal is
 *  open. Answers are rendered as plain Markdown — deliberately without the
 *  reader toolbar/settings the document view has. */
export function AiChatPanel({
  open,
  contextText,
  contextImages = [],
  initialError = null,
  initialBusy = false,
  initialBusyLabel,
  onClose,
}: AiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seed, setSeed] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [replying, setReplying] = useState(false);
  const [typingLabel, setTypingLabel] = useState("Thinking…");
  const [error, setError] = useState<string | null>(null);
  /** The host drives the busy state and the error for the whole click-to-ask
   *  flow — the page OCR only finishes after the panel is already open — so
   *  both are read straight from the props on every render instead of being
   *  snapshotted when the panel opened. Otherwise the panel would sit on
   *  “Capturing page data…” forever and never show the error the host
   *  produced a moment later. */
  const busy = initialBusy || replying;
  const shownError = initialError ?? error;
  const shownTypingLabel = initialBusy ? (initialBusyLabel ?? "Thinking…") : typingLabel;
  /** Conversation zoom in percent (applies to the message content). */
  const [zoomPct, setZoomPct] = useState(100);
  /** False until the saved zoom arrived, so the initial value is never
   *  persisted over the user's stored choice. */
  const zoomLoadedRef = useRef(false);

  /** Loads the saved chat zoom from the app settings. */
  useEffect(() => {
    let cancelled = false;
    void window.readlynx?.db.getAppSettings().then((settings) => {
      if (cancelled) return;
      zoomLoadedRef.current = true;
      const saved = settings?.chatZoom;
      if (typeof saved === "number") {
        setZoomPct(Math.min(160, Math.max(70, saved)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persists the chat zoom so the conversation stays the same size next
   *  time. */
  useEffect(() => {
    if (!zoomLoadedRef.current) return;
    void window.readlynx?.db.updateAppSettings({ chatZoom: zoomPct }).catch(() => {});
  }, [zoomPct]);
  const modelRef = useRef<AiModel | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Every saved model, so the header can offer a picker. The app default is
   *  the initial pick; the choice is per conversation and never persisted. */
  const { models, defaultModel, error: modelsError } = useAiModelList();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const activeModel = models.find((entry) => entry.Id === selectedModelId) ?? defaultModel;
  const modelError = !activeModel
    ? modelsError
    : !activeModel.APIKey || !activeModel.ModelName
      ? "This AI model is missing an API key or model name. Fix it in Settings → AI Models."
      : null;
  useEffect(() => {
    modelRef.current = activeModel?.APIKey && activeModel.ModelName ? activeModel : null;
  }, [activeModel]);

  /** Opening the panel starts a fresh conversation seeded with the current
   *  selection (text and/or image); history lives until the modal closes.
   *  Reset during render (React's recommended pattern) whenever the panel
   *  opens with a different seed. Only the panel's own state is cleared — the
   *  host's busy flag and error live in `busy` / `shownError` above. */
  const imageKey = (contextImages[0] ?? "").slice(0, 96);
  const resetKey = open ? `open:${contextText ?? ""}|${imageKey}` : null;
  const resetKeyRef = useRef<string | null>(null);
  if (resetKey !== resetKeyRef.current) {
    resetKeyRef.current = resetKey;
    if (open) {
      setMessages([]);
      setSeed(contextText ?? null);
      setInput("");
      setError(null);
      setReplying(false);
      setTypingLabel("Thinking…");
    }
  }

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  /** Keep the newest message in view. */
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const model = modelRef.current;
    if (!model) {
      setError(modelError ?? "No AI model configured.");
      return;
    }
    const apiKey = model.APIKey;
    const modelName = model.ModelName;
    if (!apiKey || !modelName) {
      setError(modelError ?? "No AI model configured.");
      return;
    }
    const apiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];
    for (const message of messages) apiMessages.push(message);
    const isFirstQuestion = apiMessages.length === 1;
    // Seed the selected text into the first question only.
    if (seed && isFirstQuestion) {
      apiMessages.push({
        role: "user",
        content: `The user selected this text from their book:\n\n"""\n${seed}\n"""\n\nAnswer the question: ${text}`,
      });
    } else {
      apiMessages.push({ role: "user", content: text });
    }
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setReplying(true);
    setTypingLabel("Thinking…");
    setError(null);
    try {
      const ai = window.readlynx?.ai;
      if (!ai) throw new Error("The AI bridge is not available.");
      const response = await ai.chat({
        input: {
          url: resolveProviderBaseUrl(model),
          apiKey,
          modelName,
        },
        messages: apiMessages,
        images: isFirstQuestion && contextImages.length > 0 ? contextImages : undefined,
      });
      setMessages([...next, { role: "assistant", content: response }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplying(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="AI chat">
        <header className={styles.header}>
          <span className={styles.title}>
            <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
            AI Assistant
          </span>
          {models.length > 0 && (
            <span className={styles.modelPicker}>
              <Select
                compact
                value={activeModel?.Id ?? ""}
                onChange={(event) => setSelectedModelId(event.target.value)}
                options={models.map((entry) => ({
                  value: entry.Id,
                  label: entry.DisplayName ?? entry.ModelName ?? entry.Provider,
                }))}
                aria-label="Model for this conversation"
                title="Model used for this conversation"
              />
            </span>
          )}
          <span className={styles.zoomControls}>
            <button
              type="button"
              className={styles.zoomButton}
              onClick={() => setZoomPct((current) => Math.max(70, current - 10))}
              aria-label="Zoom out chat content"
              title="Zoom out chat content"
            >
              <ZoomOut size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.zoomValue}
              onClick={() => setZoomPct(100)}
              title="Reset zoom to 100%"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              className={styles.zoomButton}
              onClick={() => setZoomPct((current) => Math.min(160, current + 10))}
              aria-label="Zoom in chat content"
              title="Zoom in chat content"
            >
              <ZoomIn size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close AI chat"
            title="Close AI chat"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.messages} ref={listRef} style={{ zoom: zoomPct / 100 }}>
          {messages.length === 0 && !busy && (
            <div className={styles.empty}>
              <Sparkles size={22} strokeWidth={1.6} aria-hidden="true" />
              <p>
                {seed
                  ? "Ask about the selected text, or anything else."
                  : contextImages.length > 0
                    ? "Ask about the selected area, or anything else."
                    : "Ask anything."}
              </p>
            </div>
          )}
          {messages.map((message, index) =>
            message.role === "user" ? (
              <div key={index} className={styles.userRow}>
                <div className={styles.userBubble} dir="auto">{message.content}</div>
              </div>
            ) : (
              <div key={index} className={styles.assistantRow}>
                <div className={styles.assistantBubble}>
                  <Markdown content={message.content} rawHtml={false} />
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className={styles.assistantRow}>
              <div className={styles.assistantBubble}>
                <span className={styles.typing}>{shownTypingLabel}</span>
              </div>
            </div>
          )}
        </div>

        {shownError && (
          <div className={styles.error} role="alert">
            {shownError}
          </div>
        )}

        <footer className={styles.footer}>
          <textarea
            ref={inputRef}
            className={styles.input}
            rows={1}
            dir="auto"
            placeholder={modelError ?? "Ask anything…"}
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label="Send message"
            title="Send message"
          >
            {busy ? (
              <Loader2 size={16} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
            ) : (
              <Send size={16} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
