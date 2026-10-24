import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque secrets for sessions, invitations and password resets (docs/security.md §3.4, §3.8):
 * 32 random bytes, base64url; only sha256(token) is stored. A token is never logged or audited.
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Shape check before any database lookup (43 base64url characters). */
export function looksLikeToken(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Absolute link for emails; APP_ORIGIN is the public origin (docs/deployment-railway.md). */
export function appUrl(path: string): string {
  const origin = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
  return `${origin}${path}`;
}

/**
 * Masks secrets before anything is logged (US-1-11 AC3): values of keys named like token, code,
 * password, secret, authorization, cookie, and any base64url run of 20+ characters in strings.
 */
export function redact(value: unknown): unknown {
  const SECRET_KEY = /token|code|password|secret|authorization|cookie/i;
  const mask = (s: string) => s.replace(/[A-Za-z0-9_-]{20,}/g, "•••");
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 6) return "…";
    if (typeof v === "string") return mask(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) ? "•••" : walk(x, depth + 1)]));
    }
    return v;
  };
  return walk(value, 0);
}
