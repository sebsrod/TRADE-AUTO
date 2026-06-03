import { useState } from "react";
import type { AILog } from "../../shared/types";
import { timeAgo, titleCase } from "../lib/format";

function decisionClass(d: string | null): string {
  if (d === "BUY") return "long";
  if (d === "SELL" || d === "CLOSE") return "short";
  return "muted-badge";
}

export function AILogsPanel({ logs }: { logs: AILog[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card">
      <div className="card-head">
        <h2>AI analysis log</h2>
        <span className="muted">{logs.length} entries</span>
      </div>
      {logs.length === 0 ? (
        <div className="empty">No AI activity yet. Run a cycle or analyze an asset.</div>
      ) : (
        <div className="log-list">
          {logs.map((l) => (
            <div key={l.id} className="log-row">
              <div className="log-main" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <span className={`badge ${l.kind === "discovery" ? "muted-badge" : decisionClass(l.decision)}`}>
                  {l.kind === "discovery" ? "scan" : l.decision ?? l.kind}
                </span>
                <span className="sym">{l.symbol ?? "market"}</span>
                {l.confidence != null && (
                  <span className="sub">conf {(l.confidence * 100).toFixed(0)}%</span>
                )}
                {l.sentiment && <span className="sub">· {titleCase(l.sentiment)}</span>}
                <span className="log-time">{timeAgo(l.created_at)}</span>
              </div>
              {l.rationale && (
                <p className={`log-rationale ${open === l.id ? "expanded" : ""}`}>{l.rationale}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
