import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { inventorySettings } from "@/db/schema";

/**
 * Registry of inventory policy settings (W1C). Every default is an assumption that needs owner or
 * process-owner confirmation (cited per key); values are data in `inventory_settings`
 * (site row beats organization row beats this default), never hard-coded rules.
 */
export const INVENTORY_SETTINGS = {
  /** Toast undo window for an operator's own stock move (A-UX-15, data-model settings registry). */
  "settings.ux.undo_window_seconds": { default: 60, scope: "organization", note: "A-UX-15" },
  /** Same box/lot + destination scanned again by the same user within this window answers "Already moved" (V-DUP). */
  "inventory.move.duplicate_window_seconds": { default: 300, scope: "organization", note: "A-W1C-01" },
  /** A counted line whose |variance| exceeds this % of expected (or any variance when expected is 0) needs a blind recount by a different counter. */
  "inventory.count.recount_threshold_pct": { default: 2, scope: "site", note: "A-PROC-12, A-PM-15" },
  /** Lines with |variance| ≤ this % are auto-approved. 0 = every non-zero variance needs approval (A-PROC-12). */
  "inventory.count.auto_approve_variance_pct": { default: 0, scope: "site", note: "A-PROC-12" },
  /** Any line with |variance| above this % needs a second approval step by the role below (A-PM-15: 2 %). */
  "inventory.count.second_step_variance_pct": { default: 2, scope: "site", note: "A-PM-15" },
  "inventory.count.second_step_role": { default: "owner_director", scope: "organization", note: "A-PM-15" },
  /** Adjustments whose value exceeds this amount (PHP) need a second approval step (A-PRD-21, A-PM-15). */
  "inventory.adjustment.second_step_value": { default: 20000, scope: "site", note: "A-PRD-21, A-PM-15" },
  /** When a line has no unit cost the value is unknown; true = treat as above the threshold. */
  "inventory.adjustment.unknown_value_requires_second_step": { default: false, scope: "site", note: "A-W1C-02" },
  "inventory.adjustment.second_step_role": { default: "owner_director", scope: "organization", note: "A-PM-15" },
  /** Default reservation time-to-live in hours (data-model: TTL from settings). */
  "inventory.reservation.ttl_hours": { default: 72, scope: "site", note: "A-W1C-03" },
  /** Mixed lots per box (A-PROC-22: off by default). */
  "inventory.container.allow_mixed_lots": { default: false, scope: "organization", note: "A-PROC-22" },
  /** Near-expiry buckets in days (A-KPI-03). */
  "inventory.expiry.alert_days": { default: [30, 60, 90], scope: "organization", note: "A-KPI-03" },
} as const;

export type InventorySettingKey = keyof typeof INVENTORY_SETTINGS;
type ValueOf<K extends InventorySettingKey> = (typeof INVENTORY_SETTINGS)[K]["default"] extends number
  ? number
  : (typeof INVENTORY_SETTINGS)[K]["default"] extends boolean
    ? boolean
    : (typeof INVENTORY_SETTINGS)[K]["default"] extends string
      ? string
      : number[];

/** Reads a setting: the site row, else the organization row, else the registry default. */
export async function getInventorySetting<K extends InventorySettingKey>(q: DbOrTx, organizationId: string, siteId: string | null, key: K): Promise<ValueOf<K>> {
  const rows = await q
    .select({ siteId: inventorySettings.siteId, value: inventorySettings.value })
    .from(inventorySettings)
    .where(
      and(
        eq(inventorySettings.organizationId, organizationId),
        eq(inventorySettings.key, key),
        siteId ? or(isNull(inventorySettings.siteId), eq(inventorySettings.siteId, siteId)) : isNull(inventorySettings.siteId),
      ),
    );
  const site = rows.find((r) => r.siteId !== null);
  const org = rows.find((r) => r.siteId === null);
  const def = INVENTORY_SETTINGS[key].default;
  const v = (site ?? org)?.value;
  if (v === undefined || v === null || typeof v !== typeof def || Array.isArray(v) !== Array.isArray(def)) return def as ValueOf<K>;
  return v as ValueOf<K>;
}

/** All settings with their effective values for a site (shown on the counts and adjustments pages). */
export async function effectiveInventorySettings(q: DbOrTx, organizationId: string, siteId: string) {
  const out: { key: InventorySettingKey; value: unknown; isDefault: boolean; note: string }[] = [];
  for (const key of Object.keys(INVENTORY_SETTINGS) as InventorySettingKey[]) {
    const value = await getInventorySetting(q, organizationId, siteId, key);
    out.push({ key, value, isDefault: JSON.stringify(value) === JSON.stringify(INVENTORY_SETTINGS[key].default), note: INVENTORY_SETTINGS[key].note });
  }
  return out;
}
