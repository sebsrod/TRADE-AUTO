// Small shared helpers for the worker.

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

// Round a price to a sensible number of decimals based on magnitude.
export function roundPrice(n: number): number {
  if (!Number.isFinite(n)) return n;
  const abs = Math.abs(n);
  if (abs >= 1000) return round(n, 2);
  if (abs >= 1) return round(n, 2);
  if (abs >= 0.01) return round(n, 4);
  return round(n, 8);
}

// Hours between two SQLite/ISO datetime strings (or now if `to` omitted).
export function hoursBetween(from: string, to?: string): number {
  const a = Date.parse(normalizeSqlTime(from));
  const b = to ? Date.parse(normalizeSqlTime(to)) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / 3_600_000;
}

// SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" (UTC, no T/Z).
// Normalize so Date.parse treats it as UTC.
export function normalizeSqlTime(s: string): string {
  if (!s) return s;
  if (s.includes("T")) return s;
  return s.replace(" ", "T") + "Z";
}

// Run `fn` with a timeout. On timeout the AbortSignal is aborted so the underlying
// fetch is actually cancelled (not just abandoned), freeing the Worker's subrequest.
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
