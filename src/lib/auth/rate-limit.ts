import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Postgres token buckets (docs/security.md §3.3, §4.5; table rate_limit_buckets). One atomic upsert
 * refills the bucket for the elapsed time, takes one token and returns what is left; a negative
 * balance means "limited". Buckets are keyed by limit name and a key (ip, lower(email), user id).
 */
export type Limit = { capacity: number; perSeconds: number };

export const LIMITS = {
  /** 3 reset requests per account per hour; 10 per IP per hour (§3.3). */
  password_reset_account: { capacity: 3, perSeconds: 3600 },
  password_reset_ip: { capacity: 10, perSeconds: 3600 },
  /** 20 sign-in attempts per IP per minute (§3.3, A-SEC-07). */
  login_ip: { capacity: 20, perSeconds: 60 },
  /** 5 TOTP attempts, refilling 5 per 15 minutes (≈ "5 per 5 min, then a 15 min lock", §3.3). */
  mfa_user: { capacity: 5, perSeconds: 900 },
  /** Invitation acceptance and reset-form submissions per IP (token guessing is infeasible; this stops floods). */
  token_ip: { capacity: 30, perSeconds: 3600 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

/** Takes one token. Returns true when allowed. `now` is injectable for tests. */
export async function takeToken(name: LimitName, key: string, now: Date = new Date()): Promise<boolean> {
  const { capacity, perSeconds } = LIMITS[name];
  const rate = capacity / perSeconds;
  const rows = await db.execute<{ tokens: string }>(sql`
    insert into rate_limit_buckets (id, scope, key, tokens, refilled_at, created_at)
    values (gen_random_uuid(), ${name}, ${key}, ${capacity - 1}, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    on conflict (scope, key) do update set
      tokens = greatest(-1, least(${capacity}::numeric,
        rate_limit_buckets.tokens + greatest(0, extract(epoch from (${now.toISOString()}::timestamptz - rate_limit_buckets.refilled_at))) * ${rate}::numeric) - 1),
      refilled_at = greatest(rate_limit_buckets.refilled_at, ${now.toISOString()}::timestamptz)
    returning tokens`);
  return Number(rows[0]?.tokens ?? 0) >= 0;
}
