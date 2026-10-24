import "server-only";
import type { DbOrTx } from "@/db/client";
import { SETTINGS, getSetting, type SettingValue } from "@/lib/settings";

/**
 * Inventory policy settings (W1C). Since the Wave 1 integration (ADR-028) they live in the one
 * platform settings store (`settings`, src/lib/settings.ts) with the same keys and defaults; this
 * file keeps the inventory-facing helpers. Every default is an assumption that needs owner or
 * process-owner confirmation (cited per key); values are data (site row beats organization row
 * beats the registry default), never hard-coded rules.
 */
export const INVENTORY_SETTING_KEYS = [
  "settings.ux.undo_window_seconds",
  "inventory.move.duplicate_window_seconds",
  "inventory.count.recount_threshold_pct",
  "inventory.count.auto_approve_variance_pct",
  // The second-step thresholds and roles are `approval_rules` rows since Wave 2 (US-1-14).
  "inventory.adjustment.unknown_value_requires_second_step",
  "inventory.reservation.ttl_hours",
  "inventory.container.allow_mixed_lots",
  "inventory.expiry.alert_days",
] as const satisfies readonly (keyof typeof SETTINGS)[];

export type InventorySettingKey = (typeof INVENTORY_SETTING_KEYS)[number];

/** Reads a setting: the site row, else the organization row, else the registry default. */
export async function getInventorySetting<K extends InventorySettingKey>(q: DbOrTx, organizationId: string, siteId: string | null, key: K): Promise<SettingValue<K>> {
  return getSetting(q, organizationId, key, siteId);
}

/** All inventory settings with their effective values for a site (shown on the counts and adjustments pages). */
export async function effectiveInventorySettings(q: DbOrTx, organizationId: string, siteId: string) {
  const out: { key: InventorySettingKey; value: unknown; isDefault: boolean; note: string }[] = [];
  for (const key of INVENTORY_SETTING_KEYS) {
    const value = await getInventorySetting(q, organizationId, siteId, key);
    out.push({ key, value, isDefault: JSON.stringify(value) === JSON.stringify(SETTINGS[key].default), note: SETTINGS[key].assumption });
  }
  return out;
}
