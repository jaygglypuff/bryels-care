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
