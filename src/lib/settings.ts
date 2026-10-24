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

  // Wave 2 W2A: production planning, work orders, staging and the production board (E-3-03, E-5-07)
  /** Transition switch: batches without a work order (service callers, legacy). The UI only creates batches from work orders (W05-03). */
  "production.batch.allow_without_work_order": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-W2A-01" },
  /** Separation of duties on work order release: the releaser must differ from the planner who planned it (A-PM-14). */
  "approvals.sod.work_order": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-PM-14" },
  /** Separation of duties on production plan approval (A-PM-14). */
  "approvals.sod.production_plan": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-PM-14" },
  /** Release a work order although some materials could not be reserved (W05-04: default off). */
  "production.work_order.allow_release_with_shortage": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "W05-04" },
  /** A reserved lot must expire more than this many days after the work order's planned end (W05-04 "configurable margin"). */
  "production.work_order.lot_expiry_margin_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(3650), default: 0, assumption: "A-W2A-02" },
  /** Work order reservations lapse this many days after the planned end unless staged or released earlier. */
  "production.work_order.reservation_grace_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(365), default: 3, assumption: "A-W2A-03" },
  /** Location kinds that count as a production staging area (scan destination at W05-05). */
  "production.staging.location_kinds": { scopes: ["organization", "site"], schema: z.array(z.string().min(1)).min(1).max(5), default: ["production"] as string[], assumption: "A-W2A-04" },
  /** Staged stock stays reserved for its batch this long (hours) unless consumed or released earlier. */
  "production.staging.reservation_ttl_hours": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(24 * 90), default: 168, assumption: "A-W2A-05" },
  /** Optional approval gate on production plans before lines become work orders (A-PROC-30: off by default). */
  "production.production_plan.approval_required": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-PROC-30" },
  /** Production board columns (ux-system §9.3 "configurable set", A-UX-12). Each column lists the work order and batch states it shows. */
  "production.board.columns": {
    scopes: ["organization", "site"],
    schema: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
            title: z.string().min(1).max(40),
            workOrderStatuses: z.array(z.enum(["draft", "planned", "released", "in_progress", "completed", "closed", "cancelled"])),
            batchStatuses: z.array(z.enum(["draft", "planned", "materials_staged", "in_process", "awaiting_qc", "quarantined", "released", "rejected", "rework_approved", "closed"])),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    default: [
      { key: "to_plan", title: "To plan", workOrderStatuses: ["draft"], batchStatuses: [] },
      { key: "planned", title: "Planned", workOrderStatuses: ["planned"], batchStatuses: ["draft", "planned"] },
      { key: "ready", title: "Released · to stage", workOrderStatuses: ["released"], batchStatuses: [] },
      { key: "staged", title: "Materials staged", workOrderStatuses: [], batchStatuses: ["materials_staged"] },
      { key: "in_process", title: "In process", workOrderStatuses: [], batchStatuses: ["in_process", "rework_approved"] },
      { key: "awaiting_qc", title: "Awaiting QC", workOrderStatuses: [], batchStatuses: ["awaiting_qc"] },
      { key: "quarantined", title: "Quarantined", workOrderStatuses: [], batchStatuses: ["quarantined"] },
      { key: "released", title: "Released", workOrderStatuses: [], batchStatuses: ["released"] },
    ] as {
      key: string;
      title: string;
      workOrderStatuses: ("draft" | "planned" | "released" | "in_progress" | "completed" | "closed" | "cancelled")[];
      batchStatuses: ("draft" | "planned" | "materials_staged" | "in_process" | "awaiting_qc" | "quarantined" | "released" | "rejected" | "rework_approved" | "closed")[];
    }[],
    assumption: "A-UX-12",
  },
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
