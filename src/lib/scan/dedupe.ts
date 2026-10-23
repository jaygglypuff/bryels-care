/**
 * Duplicate-scan protection (docs/ux-system.md §5.9, US-2-13 AC2). Pure and clock-injectable so it
 * is unit-tested and shared by the camera loop, the wedge listener and multi-scan flows.
 */

/** Window in which an identical scan is treated as the same physical read (camera and wedge). */
export const DUPLICATE_SCAN_WINDOW_MS = 2000;

/**
 * Drops the same payload when it arrives again within `windowMs` (a camera sees the same label
 * on consecutive frames; some wedge scanners send twice). A different payload always passes.
 */
export function createDuplicateGuard(windowMs = DUPLICATE_SCAN_WINDOW_MS, now: () => number = () => Date.now()) {
  let last: { value: string; at: number } | null = null;
  return {
    /** Returns true when the scan should be processed. */
    accept(value: string): boolean {
      const t = now();
      if (last && last.value === value && t - last.at < windowMs) {
        last = { value, at: t };
        return false;
      }
      last = { value, at: t };
      return true;
    },
    reset() {
      last = null;
    },
  };
}

/**
 * Remembers what was already scanned in one flow (pick, count, pack). A repeat outside the
 * duplicate window is not dropped silently: the caller asks "Already scanned. Scan it again?"
 * and calls `confirmRepeat` only when the person confirms.
 */
export function createFlowScanSet() {
  const seen = new Map<string, number>();
  return {
    /** "new" the first time, "repeat" when the payload was already accepted in this flow. */
    check(value: string): "new" | "repeat" {
      return seen.has(value) ? "repeat" : "new";
    },
    accept(value: string) {
      seen.set(value, (seen.get(value) ?? 0) + 1);
    },
    count(value: string) {
      return seen.get(value) ?? 0;
    },
    clear() {
      seen.clear();
    },
  };
}

/** Wedge scanners end a read with a terminator; which one is a per-device setting (A-UX-11). */
export const SCAN_TERMINATORS = ["enter", "tab", "enter_or_tab"] as const;
export type ScanTerminator = (typeof SCAN_TERMINATORS)[number];
export const DEFAULT_SCAN_TERMINATOR: ScanTerminator = "enter";

export function isTerminatorKey(key: string, terminator: ScanTerminator): boolean {
  if (terminator === "enter") return key === "Enter";
  if (terminator === "tab") return key === "Tab";
  return key === "Enter" || key === "Tab";
}
