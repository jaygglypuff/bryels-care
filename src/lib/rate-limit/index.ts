import "server-only";
import { sql, asc } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { getSetting } from "@/lib/settings";

/**
 * Shared Postgres rate-limit store (US-1-25 AC3, docs/security.md §4.5, A-SEC-14). Every web
 * replica counts in the same `rate_limit_buckets` row, so a limit is per user or per IP, not per
 * process. One upsert statement per check: the row lock serializes concurrent requests for the
 * same key and the decision is returned with the remaining allowance.
 *
 * Semantics: a fixed window that starts at the first request ("120 per minute" = at most 120
 * requests in the minute that began with the first one; `refilled_at` is the window start and
 * `tokens` what is left). When the window has passed the allowance is full again. Refused
 * requests do not consume. `Retry-After` = seconds until the window ends.
 */
export type Limit = { capacity: number; windowSeconds: number };
export type LimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export async function consume(q: DbOrTx, a: { scope: string; key: string; limit: Limit; cost?: number; now?: Date }): Promise<LimitResult> {
  const cost = a.cost ?? 1;
  const cap = a.limit.capacity;
  const win = a.limit.windowSeconds;
  const now = (a.now ?? new Date()).toISOString();
  const key = a.key.slice(0, 200);
  const expired = sql`(${now}::timestamptz - b.refilled_at) >= make_interval(secs => ${win})`;
  const rows = await q.execute<{ tokens: string; last_allowed: boolean; ends_in: string }>(sql`
    insert into rate_limit_buckets as b (id, scope, key, tokens, refilled_at, last_allowed)
    values (gen_random_uuid(), ${a.scope}, ${key}, case when ${cost}::numeric <= ${cap}::numeric then ${cap}::numeric - ${cost}::numeric else ${cap}::numeric end, ${now}::timestamptz, ${cost <= cap})
    on conflict (scope, key) do update set
      tokens = case
        when ${expired} then case when ${cost}::numeric <= ${cap}::numeric then ${cap}::numeric - ${cost}::numeric else ${cap}::numeric end
        when b.tokens >= ${cost}::numeric then b.tokens - ${cost}::numeric
        else b.tokens
      end,
      last_allowed = case when ${expired} then ${cost}::numeric <= ${cap}::numeric else b.tokens >= ${cost}::numeric end,
      refilled_at = case when ${expired} then ${now}::timestamptz else b.refilled_at end
    returning tokens::text as tokens, last_allowed,
      greatest(0, extract(epoch from (refilled_at + make_interval(secs => ${win}) - ${now}::timestamptz)))::text as ends_in`);
  const r = rows[0];
  const allowed = Boolean(r.last_allowed);
  return { allowed, remaining: Math.floor(Number(r.tokens)), retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(Number(r.ends_in))) };
}

/** Removes buckets idle for longer than `idleHours` (sweep run by `platform.metrics_sample`). */
export async function sweepBuckets(q: DbOrTx, idleHours = 24, now = new Date()): Promise<number> {
  const r = await q.execute<{ n: number }>(sql`
    with d as (delete from rate_limit_buckets where refilled_at < ${now.toISOString()}::timestamptz - make_interval(hours => ${idleHours}) returning 1)
    select count(*)::int as n from d`);
  return Number(r[0]?.n ?? 0);
}

/* ------------------------------------------------------------------ configured limits */

export type RateLimits = { api_per_minute: number; scan_lookups_per_minute: number; login_ip_per_minute: number; login_ip_per_hour: number };

/** Limits of an organization (setting `platform.rate_limits`, A-SEC-14 defaults). */
export async function rateLimitsFor(organizationId: string | null): Promise<RateLimits> {
  let org = organizationId;
  if (!org) {
    // Before sign-in there is no organization yet: use the first one created (the demo environment also
    // holds the empty sandbox company, ADR-072; a production deployment serves one, ADR-011).
    const [o] = await db.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
    org = o?.id ?? null;
  }
  if (!org) return { api_per_minute: 600, scan_lookups_per_minute: 120, login_ip_per_minute: 20, login_ip_per_hour: 200 };
  return getSetting(db, org, "platform.rate_limits");
}

/** Authenticated API: `api_per_minute` per user (docs/security.md §4.5; keyed by user, A-W2F-04). */
export async function limitApi(organizationId: string, userId: string): Promise<LimitResult> {
  const l = await rateLimitsFor(organizationId);
  return consume(db, { scope: "api_user", key: userId, limit: { capacity: l.api_per_minute, windowSeconds: 60 } });
}

/** Scan look-ups: `scan_lookups_per_minute` per user (US-2-13 AC1). */
export async function limitScanLookup(organizationId: string, userId: string): Promise<LimitResult> {
  const l = await rateLimitsFor(organizationId);
  return consume(db, { scope: "scan_lookup", key: userId, limit: { capacity: l.scan_lookups_per_minute, windowSeconds: 60 } });
}

/** Sign-in attempts per client IP: per minute and per hour (docs/security.md §3.3, A-SEC-07). */
export async function limitLoginIp(ip: string): Promise<LimitResult> {
  const l = await rateLimitsFor(null);
  const minute = await consume(db, { scope: "login_ip", key: ip, limit: { capacity: l.login_ip_per_minute, windowSeconds: 60 } });
  if (!minute.allowed) return minute;
  return consume(db, { scope: "login_ip_hour", key: ip, limit: { capacity: l.login_ip_per_hour, windowSeconds: 3600 } });
}

/**
 * Fixed limits of the unauthenticated identity flows (docs/security.md §3.3). Not settings: they guard
 * token guessing and email floods before any organization is known. Same numbers W2E shipped:
 * password reset 3 per account and 10 per IP per hour; TOTP 5 attempts per user per 15 minutes;
 * invitation acceptance / reset completion 30 per IP per hour.
 */
export const AUTH_LIMITS = {
  password_reset_account: { capacity: 3, windowSeconds: 3600 },
  password_reset_ip: { capacity: 10, windowSeconds: 3600 },
  mfa_user: { capacity: 5, windowSeconds: 900 },
  token_ip: { capacity: 30, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;
export type AuthLimitName = keyof typeof AUTH_LIMITS;

/** Takes one unit of an identity limit in the shared store; true when allowed. `now` is injectable for tests. */
export async function limitAuth(name: AuthLimitName, key: string, now: Date = new Date()): Promise<boolean> {
  return (await consume(db, { scope: name, key, limit: AUTH_LIMITS[name], now })).allowed;
}

/**
 * Client IP from the configured trusted proxy header only (TRUSTED_PROXY_HEADER, e.g.
 * x-forwarded-for → its first entry). Unset (development) → "local": every client shares one bucket.
 */
export function clientIp(h: Headers): string {
  const name = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (!name) return "local";
  const v = h.get(name);
  const first = v?.split(",")[0]?.trim();
  return first && /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : "unknown";
}
