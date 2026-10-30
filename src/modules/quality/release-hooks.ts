import "server-only";
import type { Tx } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";

/**
 * Integration points of the quality decision with other modules (ADR-080 §9), the same pattern as
 * the production execution hooks (src/modules/production/execution-hooks.ts): quality never calls
 * the batch closure directly; `registerAppHooks()` in src/modules/wiring.ts plugs production's
 * `autoCloseReleasedBatch` in. Every hook runs inside the caller's transaction, so the pass, the
 * closure and the BMR commit or roll back together. Until a hook is registered the pass still
 * releases the lot and the batch stays released for a manual close (nothing pretends to close it).
 */
export type AutoCloseResult = { closed: boolean; blockers: { code: string; label: string; detail: string }[]; documentNumber: string | null };

export type QualityReleaseHooks = {
  /** A batch was passed on Check quality: close it when every closure check passes, else generate the BMR. */
  onBatchReleased?: (tx: Tx, ctx: AuthContext, input: { batchId: string; idempotencyKey: string }) => Promise<AutoCloseResult>;
};

const REGISTRY = Symbol.for("bryels.quality.releaseHooks");
const g = globalThis as unknown as Record<symbol, QualityReleaseHooks | undefined>;
const hooks: QualityReleaseHooks = (g[REGISTRY] ??= {});

export function registerQualityReleaseHooks(h: QualityReleaseHooks) {
  Object.assign(hooks, h);
}

/** Test support: removes every registered hook. */
export function resetQualityReleaseHooks() {
  for (const k of Object.keys(hooks) as (keyof QualityReleaseHooks)[]) delete hooks[k];
}

export function qualityReleaseHooks(): Readonly<QualityReleaseHooks> {
  return hooks;
}
