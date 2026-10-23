/**
 * Per-user sliding-window limiter for scan look-ups (US-2-13 AC1: 120 per minute per session).
 *
 * In-memory per web process: enough to stop a stuck scanner or a script from hammering look-ups
 * on one replica. With several replicas the effective limit is per replica; a shared limiter
 * (Postgres or Redis) is a later hardening item (docs/security.md rate limits).
 */

export const SCAN_LOOKUPS_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

export function createRateLimiter(limit = SCAN_LOOKUPS_PER_MINUTE, windowMs = WINDOW_MS, now: () => number = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    /** Records one hit; returns false when the key is over the limit for the current window. */
    hit(key: string): boolean {
      const t = now();
      const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(t);
      hits.set(key, list);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
      }
      return true;
    },
    reset(key?: string) {
      if (key) hits.delete(key);
      else hits.clear();
    },
  };
}

/** The process-wide limiter used by the scan service. */
export const scanRateLimiter = createRateLimiter();
