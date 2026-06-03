import type { AILog, Suggestion } from "../../shared/types";
import { fmtNum, timeAgo } from "../lib/format";

export function ResearchHub({
  suggestions,
  aiLogs,
  busy,
  onApprove,
  onReject,
  onDiscover,
}: {
  suggestions: Suggestion[];
  aiLogs: AILog[];
  busy: string | null;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onDiscover: () => void;
}) {
  const commentary = aiLogs.find((l) => l.kind === "discovery" && l.rationale);
  const pending = suggestions.filter((s) => s.status === "pending");

  return (
    <div className="card">
      <div className="card-head">
        <h2>AI Research Hub</h2>
        <button className="btn tiny" onClick={onDiscover} disabled={busy != null}>
          {busy === "discover" ? "Scanning…" : "Scan markets"}
        </button>
      </div>

      {commentary && (
        <div className="commentary">
          <div className="commentary-label">Gemini market commentary · {timeAgo(commentary.created_at)}</div>
          <p>{commentary.rationale}</p>
        </div>
      )}

      <h3 className="subhead">Suggested assets to trade</h3>
      {pending.length === 0 ? (
        <div className="empty">
          No pending suggestions. Run a market scan to let Gemini surface trend swings.
        </div>
      ) : (
        <div className="suggestions">
          {pending.map((s) => {
            const hits: string[] = (() => {
              try {
                return s.indicators_hit ? JSON.parse(s.indicators_hit) : [];
              } catch {
                return [];
              }
            })();
            return (
              <div key={s.id} className="suggestion">
                <div className="suggestion-top">
                  <div>
                    <span className="sym">{s.symbol}</span>
                    <span className={`badge ${s.direction === "short" ? "short" : "long"}`}>
                      {s.direction}
                    </span>
                    {s.category && <span className="badge muted-badge">{s.category}</span>}
                  </div>
                  <div className="suggestion-conf">
                    conf {((s.confidence ?? 0) * 100).toFixed(0)}% · R:R {fmtNum(s.risk_reward, 1)}
                  </div>
                </div>
                {s.strategy && <div className="suggestion-strategy">{s.strategy}</div>}
                <p className="suggestion-why">{s.rationale}</p>
                <div className="suggestion-levels">
                  <span>Entry {fmtNum(s.entry, 2)}</span>
                  <span className="neg">Stop {fmtNum(s.stop_loss, 2)}</span>
                  <span className="pos">Target {fmtNum(s.take_profit, 2)}</span>
                </div>
                {hits.length > 0 && (
                  <div className="chips">
                    {hits.map((h, i) => (
                      <span key={i} className="chip">
                        {h}
                      </span>
                    ))}
                  </div>
                )}
                <div className="suggestion-actions">
                  <button
                    className="btn tiny primary"
                    onClick={() => onApprove(s.id)}
                    disabled={busy === `sug-${s.id}`}
                  >
                    {busy === `sug-${s.id}` ? "…" : "Approve & trade"}
                  </button>
                  <button
                    className="btn tiny ghost"
                    onClick={() => onReject(s.id)}
                    disabled={busy === `sug-${s.id}`}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
