import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { settings } from "@/db/schema";

/**
 * Typed settings registry (docs/data-model.md §3.1 `settings`). Each key has a schema and a
 * default; a stored row overrides the default (site scope over organization scope). Defaults
 * marked with an assumption id need owner or process-owner confirmation before go-live; they
 * are configuration, never business rules fixed in code.
 */
const MovementTypeEnum = z.enum(["receipt", "issue", "transfer", "consumption", "output", "adjustment", "return", "shipment", "reversal"]);

export const SETTINGS = {
  /**
   * A-PM-06: movement types a role may post. Roles not listed are unrestricted (their permission
   * strings decide). A user holding any unrestricted role is unrestricted. For `transfer`, when
   * `transferMustTouchLocationKinds` is set, the source or the destination must be of one of the
   * listed location kinds.
   */
  "inventory.role_movement_types": {
    scopes: ["organization", "site"],
    schema: z.record(
      z.string(),
      z.object({ movementTypes: z.array(MovementTypeEnum), transferMustTouchLocationKinds: z.array(z.string()).optional() }).strict(),
    ),
    default: {
      production_operator: { movementTypes: ["consumption", "output", "transfer"], transferMustTouchLocationKinds: ["production"] },
    } as Record<string, { movementTypes: z.infer<typeof MovementTypeEnum>[]; transferMustTouchLocationKinds?: string[] }>,
    assumption: "A-PM-06",
  },
  /** A-PM-17: rows per synchronous export; larger extracts must be narrowed (or go to the export job). */
  "platform.export.max_rows": { scopes: ["organization"], schema: z.number().int().min(1).max(1_000_000), default: 50_000, assumption: "A-PM-17" },
  /** US-2-03: attempts before a job is dead-lettered (first run plus retries). */
  "platform.jobs.max_attempts": { scopes: ["organization"], schema: z.number().int().min(1).max(20), default: 5, assumption: "A-W1A-02" },

  // Inventory policy (W1C; formerly the interim `inventory_settings` table, ADR-028). Same keys and defaults.
  /** Toast undo window for an operator's own stock move; 0 disables undo (A-UX-15). */
  "settings.ux.undo_window_seconds": { scopes: ["organization"], schema: z.number().int().min(0).max(3600), default: 60, assumption: "A-UX-15" },
  /** Same box/lot + destination scanned again by the same user within this window answers "Already moved" (V-DUP). */
  "inventory.move.duplicate_window_seconds": { scopes: ["organization"], schema: z.number().int().min(0).max(86_400), default: 300, assumption: "A-W1C-01" },
  /** A counted line whose |variance| exceeds this % of expected (or any variance when expected is 0) needs a blind recount by a different counter. */
  "inventory.count.recount_threshold_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 2, assumption: "A-PROC-12, A-PM-15" },
  /** Lines with |variance| ≤ this % are auto-approved. 0 = every non-zero variance needs approval. */
  "inventory.count.auto_approve_variance_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 0, assumption: "A-PROC-12" },
  /** Any line with |variance| above this % needs a second approval step by the role below. */
  "inventory.count.second_step_variance_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 2, assumption: "A-PM-15" },
  "inventory.count.second_step_role": { scopes: ["organization"], schema: z.string().min(1), default: "owner_director", assumption: "A-PM-15" },
  /** Adjustments whose value exceeds this amount (PHP) need a second approval step. */
  "inventory.adjustment.second_step_value": { scopes: ["organization", "site"], schema: z.number().min(0), default: 20000, assumption: "A-PRD-21, A-PM-15" },
  /** When a line has no unit cost the value is unknown; true = treat as above the threshold. */
  "inventory.adjustment.unknown_value_requires_second_step": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-W1C-02" },
  "inventory.adjustment.second_step_role": { scopes: ["organization"], schema: z.string().min(1), default: "owner_director", assumption: "A-PM-15" },
  /** Default reservation time-to-live in hours. */
  "inventory.reservation.ttl_hours": { scopes: ["organization", "site"], schema: z.number().min(1).max(24 * 365), default: 72, assumption: "A-W1C-03" },
  /** Mixed lots per box (off by default). */
  "inventory.container.allow_mixed_lots": { scopes: ["organization"], schema: z.boolean(), default: false, assumption: "A-PROC-22" },
  /** Near-expiry buckets in days: Expiry alerts page and `expiring_lot` notifications (US-2-16). */
  "inventory.expiry.alert_days": { scopes: ["organization"], schema: z.array(z.number().int().min(1).max(3650)).min(1).max(6), default: [30, 60, 90] as number[], assumption: "A-KPI-03" },
  // Wave 2 W2G: master data administration
  /** Product families a product may belong to (US-1-22 AC1, docs/data-model.md §3.2 `product_family`). */
  "masterdata.product_families": { scopes: ["organization"], schema: z.array(z.string().trim().min(1).max(40)).min(1).max(50), default: ["Soap", "Lotion", "Cream", "Oil", "Other"] as string[], assumption: "A-W2G-03" },

  // Wave 2 W2B: batch execution (US-3-09..13). Defaults are fictional placeholders for the process owner and QA to confirm.
  /** A-PROC-31: post ingredient consumption at each dispense (and packaging consumption at packaging) instead of at transfer to quarantine (W05-17). */
  "production.post_consumption_at_dispense": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-PROC-31" },
  /** A-PROC-33: actual yield % of theoretical outside [min, max] needs approval and a deviation before posting. Per-SKU override by product SKU code. */
  "production.yield.limits_pct": {
    scopes: ["organization", "site"],
    schema: z
      .object({ min: z.number().min(0).max(1000), max: z.number().min(0).max(1000), bySku: z.record(z.string(), z.object({ min: z.number().min(0).max(1000), max: z.number().min(0).max(1000) })).optional() })
      .refine((v) => v.min <= v.max, "min must not exceed max"),
    default: { min: 95, max: 102 } as { min: number; max: number; bySku?: Record<string, { min: number; max: number }> },
    assumption: "A-PROC-33, A-W2B-03",
  },
  /** A-PROC-19: allowed |issued − used − damaged − returned| per packaging component (base units); 0 for labels. */
  "production.packaging.reconciliation_tolerance": {
    scopes: ["organization", "site"],
    schema: z.object({ defaultQty: z.number().min(0), byMaterialCode: z.record(z.string(), z.number().min(0)).optional() }),
    default: { defaultQty: 0 } as { defaultQty: number; byMaterialCode?: Record<string, number> },
    assumption: "A-PROC-19",
  },
  /** Scrap or rework above this % of the theoretical unit count needs approval (production.scrap_rework_record.approve). */
  "production.scrap.approval_threshold_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 2, assumption: "A-W2B-04" },
  /** Reason codes offered for scrap and rework records. */
  "production.scrap_rework.reason_codes": {
    scopes: ["organization"],
    schema: z.array(z.object({ code: z.string().regex(/^[a-z0-9_]{2,40}$/), label: z.string().min(2).max(80) })).min(1),
    default: [
      { code: "broken_bar", label: "Broken or cracked unit" },
      { code: "underweight", label: "Underweight unit" },
      { code: "appearance", label: "Appearance defect" },
      { code: "packaging_damage", label: "Damaged in packaging" },
      { code: "other", label: "Other (explain in the note)" },
    ] as { code: string; label: string }[],
    assumption: "A-W2B-05",
  },
  /** A-PROC-08: finished-lot expiry basis: manufacture (batch start) date or packaging date, plus product shelf life. */
  "production.output.expiry_basis": { scopes: ["organization"], schema: z.enum(["manufacture_date", "packaging_date"]), default: "manufacture_date" as "manufacture_date" | "packaging_date", assumption: "A-PROC-08" },
  /** W13-02: equipment with cleaning rule per_batch becomes "dirty" (cleaning required) when its use on a batch ends. */
  "production.equipment.mark_dirty_after_batch_use": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-W2B-06" },

  // Wave 2 W2C: QA release, deviations, genealogy, bulk disposition, label verification (A-W2C-nn in docs/PRD.md).
  /** Hours from creation until an inspection shows as overdue in the QA queue (scheduling aid, not a quality rule). */
  "quality.inspection.due_hours": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(24 * 60), default: 48, assumption: "A-W2C-01" },
  /** Deviation severity classes qa_qc chooses from (W07-01). The company's QA defines the classes and their meaning. */
  "quality.deviation.severity_levels": {
    scopes: ["organization"],
    schema: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).min(1).max(10),
    default: ["minor", "major", "critical"] as string[],
    assumption: "A-W2C-02",
  },
  /** Q-QA-03: conditional release (second approver, conditions and review date). Off until the company's QA policy allows it. */
  "quality.conditional_release.enabled": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "Q-QA-03" },
  /** A-DM-10: depth limit of a genealogy trace (safety net; a trace that reaches it says so). */
  "quality.genealogy.max_depth": { scopes: ["organization"], schema: z.number().int().min(2).max(50), default: 20, assumption: "A-DM-10" },
  /** US-2-23: largest selection one bulk disposition may apply. */
  "quality.bulk_disposition.max_lots": { scopes: ["organization"], schema: z.number().int().min(1).max(5000), default: 500, assumption: "A-W2C-03" },
  /** A-RPT-10: a QA status change of a lot queues a label reprint for that lot (boxes inherit and are verified by scan). */
  "labels.reprint_on_status_change": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-RPT-10" },
  /** MC-06: share of labels in a zone that must be scan-verified before the zone counts as done. */
  "inventory.label_verification.target_pct": { scopes: ["organization"], schema: z.number().min(0).max(100), default: 99, assumption: "MC-06" },

  // Wave 2 W2D: BMR documents, closure and hybrid paper records (E-3-06).
  /** Code of the document template used for batch BMRs (kind `bmr`, renderer `bmr` v1). A product-specific template field comes with SKUs. */
  "documents.bmr.template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "BMR-STD", assumption: "A-W2D-01" },
  /** Code of the template for blank hybrid paper pages (kind `bmr`, renderer `bmr_paper_page` v1). */
  "documents.bmr.paper_page_template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "BMR-PAPER", assumption: "A-W2D-01" },
  /** Which copy is the controlled record until QA validates electronic sign-offs (A-RPT-06, Q-QA-05). Printed on the BMR. */
  "documents.controlled_record": { scopes: ["organization", "site"], schema: z.enum(["paper", "electronic"]), default: "paper" as "paper" | "electronic", assumption: "A-RPT-06" },
  /** Document kinds whose reprint notifies QA in-app (A-OPS-07). */
  "documents.reprint.notify_qa_kinds": { scopes: ["organization"], schema: z.array(z.string().regex(/^[a-z_]{1,40}$/)).max(20), default: ["bmr"] as string[], assumption: "A-OPS-07" },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

/**
 * Reads a setting: site row, else organization row, else the registry default. A stored value
 * that no longer validates falls back to the default (and is reported by diagnostics later),
 * so a bad row can never widen access.
 */
export async function getSetting<K extends SettingKey>(q: DbOrTx, organizationId: string, key: K, siteId?: string | null): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  const rows = await q
    .select({ scope: settings.scope, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.organizationId, organizationId),
        eq(settings.key, key),
        siteId
          ? or(and(eq(settings.scope, "site"), eq(settings.siteId, siteId)), and(eq(settings.scope, "organization"), isNull(settings.siteId)))
          : and(eq(settings.scope, "organization"), isNull(settings.siteId)),
      ),
    );
  const row = rows.find((r) => r.scope === "site") ?? rows.find((r) => r.scope === "organization");
  if (row) {
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) return parsed.data as SettingValue<K>;
  }
  return def.default as SettingValue<K>;
}
