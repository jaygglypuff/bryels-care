/**
 * Migration window guard (docs/data-migration-plan.md §9.4, §12.4, A-MIG-08; docs/deployment-railway.md
 * `MIGRATION_WINDOW_OPEN`; docs/operations-runbook.md §17a.2). Pure so it is unit-tested.
 *
 * Command-line loader (US-2-25 AC2):
 * - on production (`APP_ENV=production`) every run, dry runs included, needs `MIGRATION_WINDOW_OPEN=true`;
 * - `--post` additionally needs the application read-only maintenance mode switched on (US-2-30), in every
 *   environment, so a rehearsal follows the same procedure as the cutover; the loader user must be on the
 *   mode's allow-list or every write is refused anyway.
 * Wizard: posting an `opening_stock` import on production needs `MIGRATION_WINDOW_OPEN=true` (the variable
 * "lets the opening-balance loader and opening_balance import jobs run against production").
 */
export type GuardEnv = { APP_ENV?: string; MIGRATION_WINDOW_OPEN?: string };

export const isProduction = (env: GuardEnv) => (env.APP_ENV ?? "").trim().toLowerCase() === "production";
export const windowOpen = (env: GuardEnv) => (env.MIGRATION_WINDOW_OPEN ?? "").trim().toLowerCase() === "true";

export function loaderGuard(env: GuardEnv, o: { mode: "dry_run" | "post" | "approve"; readOnlyEnabled: boolean }): { ok: true } | { ok: false; reason: string } {
  if (isProduction(env) && !windowOpen(env)) {
    return { ok: false, reason: "Refusing to run against production: MIGRATION_WINDOW_OPEN=true is not set. The devops engineer opens the window for the cutover only (docs/operations-runbook.md §17a.2)." };
  }
  if (o.mode === "post" && !windowOpen(env)) {
    return { ok: false, reason: "Refusing to post: MIGRATION_WINDOW_OPEN=true is not set for this load window." };
  }
  if (o.mode === "post" && !o.readOnlyEnabled) {
    return { ok: false, reason: "Refusing to post: switch on the read-only maintenance mode (platform.maintenance.read_only, with the loader's role on the allow-list) before loading, so nobody posts stock during the load." };
  }
  return { ok: true };
}

/** Wizard posting of kinds that need the window (opening stock) on production. */
export function wizardPostGuard(env: GuardEnv, requiresWindow: boolean): { ok: true } | { ok: false; reason: string } {
  if (requiresWindow && isProduction(env) && !windowOpen(env)) {
    return { ok: false, reason: "Opening stock can be posted on production only inside the cutover window (MIGRATION_WINDOW_OPEN=true, set by the devops engineer)." };
  }
  return { ok: true };
}
