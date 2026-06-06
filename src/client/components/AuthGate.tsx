import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { User } from "../../shared/types";

type Mode = "login" | "signup";

// Full-screen authentication gate. On success it hands the signed-in user up to App,
// which then loads the dashboard. The session cookie is set by the server.
export function AuthScreen({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api.login({ email: email.trim(), password })
          : await api.signup({ name: name.trim(), email: email.trim(), password });
      onAuthed(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">▲</div>
          <div>
            <h1>TRADE-AUTO</h1>
            <p className="brand-sub">Autonomous Claude paper-trading desk</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Log in
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Trader"
                autoComplete="name"
              />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          </label>

          {error && <div className="auth-error">⚠ {error}</div>}

          <button className="btn primary auth-submit" type="submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Log in" : "Create account & start"}
          </button>
        </form>

        <p className="auth-foot">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
          {" · "}
          Each account starts with $100,000 in paper capital.
        </p>
      </div>
    </div>
  );
}
