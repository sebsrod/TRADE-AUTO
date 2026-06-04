// Authentication primitives — all keyless, built on the Workers WebCrypto API.
//
// Passwords: PBKDF2-HMAC-SHA256 (100k iterations, per-user 16-byte salt), stored as
// base64 of the derived 256-bit key. Sessions: 256-bit random opaque tokens; only the
// SHA-256 hash is stored in D1, the raw token lives in an HttpOnly cookie. There is no
// server-side secret to manage — security rests on the CSPRNG token + hashed-at-rest.

import type { UserRow } from "../types";
import type { User } from "../../shared/types";

// The Cloudflare Workers (workerd) runtime hard-caps PBKDF2 at 100,000 iterations
// and rejects anything higher at runtime ("iteration counts above 100000 are not
// supported"). This is the maximum allowed; there is no compatibility flag to lift it.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const TOKEN_BYTES = 32;

// Session cookie name + lifetime (days). Tokens are opaque + hashed at rest.
export const SESSION_COOKIE = "ta_session";
export const SESSION_TTL_DAYS = 30;

const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

// Constant-time comparison of two equal-purpose strings (avoids leaking match
// position via early return). Length mismatch is reported in constant time too.
function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

// Hash a new password → {hash, salt} (both base64), to store on the user row.
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);
  return { hash: toB64(hash), salt: toB64(salt) };
}

// Verify a password against a stored hash+salt in constant time.
export async function verifyPassword(
  password: string,
  hashB64: string | null,
  saltB64: string | null,
): Promise<boolean> {
  if (!hashB64 || !saltB64) return false;
  let candidate: string;
  try {
    candidate = toB64(await derive(password, fromB64(saltB64)));
  } catch {
    return false;
  }
  return timingSafeEqual(candidate, hashB64);
}

// A fresh opaque session token (returned raw for the cookie) + its at-rest hash.
export async function newSessionToken(): Promise<{ token: string; tokenHash: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const token = toB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { token, tokenHash: await hashToken(token) };
}

// SHA-256(token) as hex — what we persist and look up by.
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return toHex(new Uint8Array(digest));
}

// Strip credential columns before a user row is ever sent to the client.
export function sanitizeUser(row: UserRow): User {
  const { password_hash: _h, password_salt: _s, ...pub } = row;
  return pub;
}

// Basic email shape check (defensive; the unique index is the real guard).
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
