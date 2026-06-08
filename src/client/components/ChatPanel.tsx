import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/types";
import { timeAgo } from "../lib/format";

export function ChatPanel({
  messages,
  sending,
  aiOnline,
  strategyUpdate,
  onSend,
  onClear,
  onApplyStrategy,
  onDismissStrategy,
}: {
  messages: ChatMessage[];
  sending: boolean;
  aiOnline: boolean;
  strategyUpdate: string | null;
  onSend: (message: string) => void;
  onClear: () => void;
  onApplyStrategy: (notes: string) => void;
  onDismissStrategy: () => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, strategyUpdate]);

  const submit = () => {
    const t = text.trim();
    if (!t || sending) return;
    onSend(t);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="card chat-card">
      <div className="card-head">
        <h2>Chat with Claude</h2>
        <div className="chat-head-actions">
          <span className={`ai-dot ${aiOnline ? "on" : "off"}`}>
            ● {aiOnline ? "online" : "offline"}
          </span>
          {messages.length > 0 && (
            <button className="btn tiny ghost" onClick={onClear} disabled={sending}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !sending ? (
          <div className="chat-hint">
            Ask Claude to analyze an asset (“analyze BTCUSDT on the 4h”), explain a trade, or
            describe how you like to trade — it will fold your style into the desk's strategy.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-bubble">{m.content}</div>
              <div className="chat-meta">
                {m.role === "assistant" ? "Claude" : "You"}
                {m.asset_symbol ? ` · ${m.asset_symbol}` : ""} · {timeAgo(m.created_at)}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="chat-msg assistant">
            <div className="chat-bubble typing">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}
      </div>

      {strategyUpdate && (
        <div className="strategy-suggest">
          <div className="reason-label">Claude suggests updating your trading style</div>
          <p>{strategyUpdate}</p>
          <div className="strategy-suggest-actions">
            <button className="btn tiny primary" onClick={() => onApplyStrategy(strategyUpdate)} disabled={sending}>
              Apply to my strategy
            </button>
            <button className="btn tiny ghost" onClick={onDismissStrategy} disabled={sending}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="chat-input">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Claude…  (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={sending}
        />
        <button className="btn primary" onClick={submit} disabled={sending || !text.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
