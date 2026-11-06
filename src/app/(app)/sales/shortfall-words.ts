import type { ActionState } from "@/lib/errors";

/**
 * ADR-110 C16: plain words for the set-aside shortage message of the allocation service (`describeShortfall`,
 * src/modules/sales/allocation.ts, owned by fulfilment): "released stock" and "allocate" are not floor words. The
 * service text stays as it is (logs, API); the screen shows this. Pure; unit-tested in tests/unit/round-c16-words.test.ts.
 */
export function plainShortfall(message: string): string {
  return message
    .replace("No stock could be allocated.", "No stock could be set aside.")
    .replace("Not enough released stock —", "Not enough stock that QA said OK to use:")
    .replace("allocate again when more stock is released", "set aside the rest when more stock is OK to use")
    .replace(/\breleased stock\b/g, "stock that QA said OK to use");
}

/** The same words on an action result (success or error). */
export function plainShortfallState(s: ActionState): ActionState {
  return s?.message ? { ...s, message: plainShortfall(s.message) } : s;
}
