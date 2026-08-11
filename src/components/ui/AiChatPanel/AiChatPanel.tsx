import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Markdown } from "../Markdown/Markdown";
import { resolveProviderBaseUrl } from "../../../services/aiProviderConfig";
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
  const [busy, setBusy] = useState(false);
  const [typingLabel, setTypingLabel] = useState("Thinking…");
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const modelRef = useRef<{ url: string; apiKey: string; modelName: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Loads the default AI model once (same pick as the translation panel). */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const db = window.readlynx?.db;
      if (!db) return;
      try {
        const models = await db.listAiModels();
        if (cancelled) return;
        const selected = models.find((entry) => entry.IsDefault) ?? models[0] ?? null;
        if (!selected?.APIKey || !selected.ModelName) {
          setModelError("No AI model configured. Add one in Settings → AI Models.");
          return;
        }
        modelRef.current = {
          url: resolveProviderBaseUrl(selected),
          apiKey: selected.APIKey,
          modelName: selected.ModelName,
        };
      } catch {
        // keep silent; sending will surface the error
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Opening the panel starts a fresh conversation seeded with the current
   *  selection (text and/or image); history lives until the modal closes.
   *  Reset during render (React's recommended pattern) whenever the panel
   *  opens with a different seed. */
  const imageKey = (contextImages[0] ?? "").slice(0, 96);
  const resetKey = open ? `open:${contextText ?? ""}|${imageKey}` : null;
  const resetKeyRef = useRef<string | null>(null);
  if (resetKey !== resetKeyRef.current) {
    resetKeyRef.current = resetKey;
    if (open) {
      setMessages([]);
      setSeed(contextText ?? null);
      setInput("");
      setError(initialError);
      setBusy(initialBusy);
      setTypingLabel(initialBusy ? (initialBusyLabel ?? "Thinking…") : "Thinking…");
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
    setBusy(true);
    setTypingLabel("Thinking…");
    setError(null);
    try {
      const ai = window.readlynx?.ai;
      if (!ai) throw new Error("The AI bridge is not available.");
      const response = await ai.chat({
        input: model,
        messages: apiMessages,
        images: isFirstQuestion && contextImages.length > 0 ? contextImages : undefined,
      });
      setMessages([...next, { role: "assistant", content: response }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

        <div className={styles.messages} ref={listRef}>
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
                <div className={styles.userBubble}>{message.content}</div>
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
                <span className={styles.typing}>{typingLabel}</span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <footer className={styles.footer}>
          <textarea
            ref={inputRef}
            className={styles.input}
            rows={1}
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
