/**
 * In-memory sliding-window limiter (Wave 1). The scan service now uses the shared Postgres store
 * (src/lib/rate-limit, `limitScanLookup`, US-1-25), so every replica counts against one limit;
 * this pure helper stays for unit tests and single-process tools only.
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
