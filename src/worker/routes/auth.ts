import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppBindings } from "../types";
import {
  createSession,
  createUser,
  deleteSession,
  getUser,
  getUserByEmail,
} from "../db";
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  hashPassword,
  hashToken,
  isValidEmail,
  newSessionToken,
  sanitizeUser,
  verifyPassword,
} from "../services/auth";

const auth = new Hono<AppBindings>();

const MIN_PASSWORD = 8;

// Issue a new session and attach the cookie. Secure is set only over HTTPS so the
// cookie still works on http://localhost during `wrangler pages dev`.
async function startSession(c: any, userId: number): Promise<void> {
  const { token, tokenHash } = await newSessionToken();
  await createSession(c.env, tokenHash, userId, SESSION_TTL_DAYS);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

// POST /api/auth/signup — create an account ($100k paper balance) and log in.
auth.post("/signup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim().slice(0, 80);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!isValidEmail(email)) return c.json({ error: "A valid email is required" }, 400);
  if (password.length < MIN_PASSWORD) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400);
  }

  const existing = await getUserByEmail(c.env, email);
  if (existing) return c.json({ error: "An account with that email already exists" }, 409);

  const { hash, salt } = await hashPassword(password);
  let user;
  try {
    user = await createUser(c.env, {
      name: name || email.split("@")[0],
      email,
      password_hash: hash,
      password_salt: salt,
    });
  } catch {
    // Unique-index race: another signup with the same email won.
    return c.json({ error: "An account with that email already exists" }, 409);
  }

  await startSession(c, user.id);
  return c.json({ user: sanitizeUser(user) }, 201);
});

// POST /api/auth/login — verify credentials and start a session.
auth.post("/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  const user = await getUserByEmail(c.env, email);
  const ok = await verifyPassword(password, user?.password_hash ?? null, user?.password_salt ?? null);
  // Uniform error + work whether or not the email exists (avoids user enumeration).
  if (!user || !ok) return c.json({ error: "Invalid email or password" }, 401);

  await startSession(c, user.id);
  return c.json({ user: sanitizeUser(user) });
});

// POST /api/auth/logout — revoke the current session and clear the cookie.
auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    try {
      await deleteSession(c.env, await hashToken(token));
    } catch {
      // ignore — we clear the cookie regardless
    }
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// GET /api/auth/me — the current account (this route is behind the session guard).
auth.get("/me", async (c) => {
  const user = await getUser(c.env, c.get("userId"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user: sanitizeUser(user) });
});

export default auth;
