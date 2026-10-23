import { z } from "zod";
import { defineJob } from "@/modules/platform/job-definition";
import { type RebuildPayload, type ReconcilePayload, rebuildBalances, rebuildKeysHash, runReconciliation } from "./reconciliation";

const manilaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * `inventory.reconcile` (docs/architecture.md §8): nightly at 01:00 Asia/Manila for every site,
 * and on demand per site. Key `(kind, as_of_date)`; on-demand runs key on the minute so a second
 * request later the same day still runs.
 */
export const inventoryReconcileJob = defineJob<ReconcilePayload>({
  code: "inventory.reconcile",
  title: "Stock ledger reconciliation",
  description: "Compares the stock ledger with the balance projection and reports differences; never corrects them.",
  payload: z.object({ siteId: z.uuid().nullable(), asOf: z.iso.datetime(), trigger: z.enum(["schedule", "manual"]) }).strict(),
  keyTuple: (p) => ["inventory_balances", p.siteId ?? "all", p.trigger === "schedule" ? manilaDate(p.asOf) : p.asOf.slice(0, 16)],
  systemPermissions: ["inventory.balance.view"],
  schedule: { cron: "0 1 * * *", tz: "Asia/Manila", payload: (now) => ({ siteId: null, asOf: now.toISOString(), trigger: "schedule" }) },
  run: (run, payload) => runReconciliation(run, payload),
});

/** `inventory.rebuild_balances`: key `(reconciliation_run_id, balance_keys_hash)`; runs on behalf of the requester. */
export const inventoryRebuildBalancesJob = defineJob<RebuildPayload>({
  code: "inventory.rebuild_balances",
  title: "Rebuild stock balances from the ledger",
  description: "Recomputes balance projection rows of a site (or a lot set) from the ledger; audited.",
  payload: z
    .object({
      siteId: z.uuid(),
      reconciliationRunId: z.uuid().nullable(),
      lotIds: z.array(z.uuid()).max(5000).nullable(),
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
  keyTuple: (p) => [p.reconciliationRunId ?? "manual", p.siteId, rebuildKeysHash(p)],
  maxAttempts: 3,
  run: (run, payload) => rebuildBalances(run, payload),
  summarize: (p) => ({ siteId: p.siteId, reconciliationRunId: p.reconciliationRunId, lots: p.lotIds ? p.lotIds.length : "all", reason: p.reason }),
});
