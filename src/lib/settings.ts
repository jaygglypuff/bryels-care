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
 *
 * Changes go through src/modules/governance (US-1-14, US-1-19): `requiresApproval` keys become a
 * `setting_change_requests` row approved by a second person; `restricted` keys need re-authentication.
 */
const MovementTypeEnum = z.enum(["receipt", "issue", "transfer", "consumption", "output", "adjustment", "return", "shipment", "reversal"]);

/**
 * Registry entry. `requiresApproval`: a change is proposed as a `setting_change_requests` row and
 * applied only when a different holder of `platform.settings.approve` approves it (US-1-14).
 * `restricted`: changing it needs re-authentication (password) under `platform.settings.admin`.
 * `group` and `label` drive the settings admin screen (US-1-19).
 */
export type SettingDefinition = {
  scopes: readonly ("organization" | "site")[];
  schema: z.ZodType;
  default: unknown;
  assumption: string;
  group: string;
  label: string;
  description?: string;
  requiresApproval?: boolean;
  restricted?: boolean;
};

const MaintenanceSchema = z.object({ enabled: z.boolean(), allowed_role_codes: z.array(z.string().regex(/^[a-z_]+$/)).max(20) }).strict();
const RateLimitSchema = z
  .object({
    api_per_minute: z.number().int().min(10).max(100_000),
    scan_lookups_per_minute: z.number().int().min(10).max(10_000),
    login_ip_per_minute: z.number().int().min(1).max(10_000),
    login_ip_per_hour: z.number().int().min(1).max(100_000),
  })
  .strict();

const sodSetting = (label: string) =>
  ({
    scopes: ["organization"],
    schema: z.boolean(),
    default: true as boolean,
    assumption: "A-PM-14",
    group: "Approvals",
    label,
    description: "When off, the person who submitted a record of this type may also approve it. Mandatory types (stock, finance, quality) ignore this switch.",
    requiresApproval: true,
  }) as const;

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
    group: "Inventory",
    label: "Movement types per role",
    description: "Which stock movement types a role may post. Roles not listed are limited only by their permissions.",
    requiresApproval: true,
  },
  /** A-PM-17: rows per synchronous export; larger extracts must be narrowed (or go to the export job). */
  "platform.export.max_rows": { scopes: ["organization"], schema: z.number().int().min(1).max(1_000_000), default: 50_000, assumption: "A-PM-17", group: "Platform", label: "Maximum rows per export" },
  /** US-2-03: attempts before a job is dead-lettered (first run plus retries). */
  "platform.jobs.max_attempts": { scopes: ["organization"], schema: z.number().int().min(1).max(20), default: 5, assumption: "A-W1A-02", group: "Platform", label: "Job attempts before dead-letter" },

  // Inventory policy (W1C; formerly the interim `inventory_settings` table, ADR-028). Same keys and defaults.
  // The second-step approval thresholds and roles moved to `approval_rules` in Wave 2 (US-1-14).
  /** Toast undo window for an operator's own stock move; 0 disables undo (A-UX-15). */
  "settings.ux.undo_window_seconds": { scopes: ["organization"], schema: z.number().int().min(0).max(3600), default: 60, assumption: "A-UX-15", group: "Inventory", label: "Undo window for a stock move (seconds)" },
  /** Same box/lot + destination scanned again by the same user within this window answers "Already moved" (V-DUP). */
  "inventory.move.duplicate_window_seconds": { scopes: ["organization"], schema: z.number().int().min(0).max(86_400), default: 300, assumption: "A-W1C-01", group: "Inventory", label: "Duplicate move window (seconds)" },
  /** A counted line whose |variance| exceeds this % of expected (or any variance when expected is 0) needs a blind recount by a different counter. */
  "inventory.count.recount_threshold_pct": {
    scopes: ["organization", "site"],
    schema: z.number().min(0).max(100),
    default: 2,
    assumption: "A-PROC-12, A-PM-15",
    group: "Inventory",
    label: "Recount above variance (%)",
    requiresApproval: true,
  },
  /** Lines with |variance| ≤ this % are auto-approved. 0 = every non-zero variance needs approval. */
  "inventory.count.auto_approve_variance_pct": {
    scopes: ["organization", "site"],
    schema: z.number().min(0).max(100),
    default: 0,
    assumption: "A-PROC-12",
    group: "Inventory",
    label: "Auto-approve count variance up to (%)",
    requiresApproval: true,
  },
  /** When a line has no unit cost the value is unknown; true = treat it as above every amount threshold of `approval_rules`. */
  "inventory.adjustment.unknown_value_requires_second_step": {
    scopes: ["organization", "site"],
    schema: z.boolean(),
    default: false,
    assumption: "A-W1C-02",
    group: "Inventory",
    label: "Unknown adjustment value counts as above every threshold",
    requiresApproval: true,
  },
  /** Default reservation time-to-live in hours. */
  "inventory.reservation.ttl_hours": { scopes: ["organization", "site"], schema: z.number().min(1).max(24 * 365), default: 72, assumption: "A-W1C-03", group: "Inventory", label: "Reservation time-to-live (hours)" },
  /** Mixed lots per box (off by default). */
  "inventory.container.allow_mixed_lots": { scopes: ["organization"], schema: z.boolean(), default: false, assumption: "A-PROC-22", group: "Inventory", label: "Allow mixed lots in one box" },
  /** Near-expiry buckets in days: Expiry alerts page and `expiring_lot` notifications (US-2-16). */
  // Wave 2 W2G: master data administration
  /** Product families a product may belong to (US-1-22 AC1, docs/data-model.md §3.2 `product_family`). */
  "masterdata.product_families": { scopes: ["organization"], schema: z.array(z.string().trim().min(1).max(40)).min(1).max(50), default: ["Soap", "Lotion", "Cream", "Oil", "Other"] as string[], assumption: "A-W2G-03", group: "Master data", label: "Product families" },

  // Wave 2 W2B: batch execution (US-3-09..13). Defaults are fictional placeholders for the process owner and QA to confirm.
  /** A-PROC-31: post ingredient consumption at each dispense (and packaging consumption at packaging) instead of at transfer to quarantine (W05-17). */
  "production.post_consumption_at_dispense": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-PROC-31", group: "Production", label: "Post ingredient consumption at each dispense", requiresApproval: true },
  /** A-PROC-33: actual yield % of theoretical outside [min, max] needs approval and a deviation before posting. Per-SKU override by product SKU code. */
  "production.yield.limits_pct": {
    scopes: ["organization", "site"],
    schema: z
      .object({ min: z.number().min(0).max(1000), max: z.number().min(0).max(1000), bySku: z.record(z.string(), z.object({ min: z.number().min(0).max(1000), max: z.number().min(0).max(1000) })).optional() })
      .refine((v) => v.min <= v.max, "min must not exceed max"),
    default: { min: 95, max: 102 } as { min: number; max: number; bySku?: Record<string, { min: number; max: number }> },
    assumption: "A-PROC-33, A-W2B-03", group: "Production", label: "Yield limits (% of theoretical)", requiresApproval: true,
  },
  /** A-PROC-19: allowed |issued − used − damaged − returned| per packaging component (base units); 0 for labels. */
  "production.packaging.reconciliation_tolerance": {
    scopes: ["organization", "site"],
    schema: z.object({ defaultQty: z.number().min(0), byMaterialCode: z.record(z.string(), z.number().min(0)).optional() }),
    default: { defaultQty: 0 } as { defaultQty: number; byMaterialCode?: Record<string, number> },
    assumption: "A-PROC-19", group: "Production", label: "Packaging reconciliation tolerance", requiresApproval: true,
  },
  /** Scrap or rework above this % of the theoretical unit count needs approval (production.scrap_rework_record.approve). */
  "production.scrap.approval_threshold_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 2, assumption: "A-W2B-04", group: "Production", label: "Scrap or rework needs approval above (%)", requiresApproval: true },
  // Scrap and rework reasons moved to the shared reason codes (categories scrap / rework, US-1-24).
  /** A-PROC-08: finished-lot expiry basis: manufacture (batch start) date or packaging date, plus product shelf life. */
  "production.output.expiry_basis": { scopes: ["organization"], schema: z.enum(["manufacture_date", "packaging_date"]), default: "manufacture_date" as "manufacture_date" | "packaging_date", assumption: "A-PROC-08", group: "Production", label: "Finished-lot expiry basis", requiresApproval: true },
  /** W13-02: equipment with cleaning rule per_batch becomes "dirty" (cleaning required) when its use on a batch ends. */
  "production.equipment.mark_dirty_after_batch_use": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-W2B-06", group: "Production", label: "Mark per-batch equipment dirty after use" },

  // Wave 2 W2C: QA release, deviations, genealogy, bulk disposition, label verification (A-W2C-nn in docs/PRD.md).
  /** Hours from creation until an inspection shows as overdue in the QA queue (scheduling aid, not a quality rule). */
  "quality.inspection.due_hours": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(24 * 60), default: 48, assumption: "A-W2C-01", group: "Quality", label: "Inspection overdue after (hours)" },
  /** Deviation severity classes qa_qc chooses from (W07-01). The company's QA defines the classes and their meaning. */
  "quality.deviation.severity_levels": {
    scopes: ["organization"],
    schema: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).min(1).max(10),
    default: ["minor", "major", "critical"] as string[],
    assumption: "A-W2C-02", group: "Quality", label: "Deviation severity levels", requiresApproval: true,
  },
  /** Q-QA-03: conditional release (second approver, conditions and review date). Off until the company's QA policy allows it. */
  "quality.conditional_release.enabled": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "Q-QA-03", group: "Quality", label: "Allow conditional release", requiresApproval: true },
  /** A-DM-10: depth limit of a genealogy trace (safety net; a trace that reaches it says so). */
  "quality.genealogy.max_depth": { scopes: ["organization"], schema: z.number().int().min(2).max(50), default: 20, assumption: "A-DM-10", group: "Quality", label: "Genealogy trace depth limit" },
  /** US-2-23: largest selection one bulk disposition may apply. */
  "quality.bulk_disposition.max_lots": { scopes: ["organization"], schema: z.number().int().min(1).max(5000), default: 500, assumption: "A-W2C-03", group: "Quality", label: "Maximum lots per bulk disposition" },
  /** A-RPT-10: a QA status change of a lot queues a label reprint for that lot (boxes inherit and are verified by scan). */
  "labels.reprint_on_status_change": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-RPT-10", group: "Documents and labels", label: "Queue label reprint on QA status change" },
  /** MC-06: share of labels in a zone that must be scan-verified before the zone counts as done. */
  "inventory.label_verification.target_pct": { scopes: ["organization"], schema: z.number().min(0).max(100), default: 99, assumption: "MC-06", group: "Documents and labels", label: "Label verification target (%)" },

  // Wave 2 W2D: BMR documents, closure and hybrid paper records (E-3-06).
  /** Code of the document template used for batch BMRs (kind `bmr`, renderer `bmr` v1). A product-specific template field comes with SKUs. */
  "documents.bmr.template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "BMR-STD", assumption: "A-W2D-01", group: "Documents and labels", label: "BMR template code" },
  /** Code of the template for blank hybrid paper pages (kind `bmr`, renderer `bmr_paper_page` v1). */
  "documents.bmr.paper_page_template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "BMR-PAPER", assumption: "A-W2D-01", group: "Documents and labels", label: "Paper page template code" },
  /** Which copy is the controlled record until QA validates electronic sign-offs (A-RPT-06, Q-QA-05). Printed on the BMR. */
  "documents.controlled_record": { scopes: ["organization", "site"], schema: z.enum(["paper", "electronic"]), default: "paper" as "paper" | "electronic", assumption: "A-RPT-06", group: "Documents and labels", label: "Controlled record (paper or electronic)", requiresApproval: true },
  /** Document kinds whose reprint notifies QA in-app (A-OPS-07). */
  "documents.reprint.notify_qa_kinds": { scopes: ["organization"], schema: z.array(z.string().regex(/^[a-z_]{1,40}$/)).max(20), default: ["bmr"] as string[], assumption: "A-OPS-07", group: "Documents and labels", label: "Document kinds whose reprint notifies QA" },

  // Wave 2 W2E: identity and session policy (docs/security.md §3.2-§3.8). Organization scope only.
  /** Idle timeout of a standard session, sliding (A-SEC-08). */
  "session.idle_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(7 * 24 * 60), default: 12 * 60, assumption: "A-SEC-08", group: "Security", label: "Session idle timeout (minutes)", restricted: true },
  /** Idle timeout when the user holds a restricted (R) permission or an always-privileged role (A-SEC-09). */
  "session.idle_minutes_privileged": { scopes: ["organization"], schema: z.number().int().min(5).max(24 * 60), default: 60, assumption: "A-SEC-09", group: "Security", label: "Privileged session idle timeout (minutes)", restricted: true },
  /** Idle timeout when "This is a shared device" was ticked at sign-in (floor tablets; Q-OFF-02). */
  "session.idle_minutes_shared_device": { scopes: ["organization"], schema: z.number().int().min(2).max(24 * 60), default: 30, assumption: "A-W2E-01", group: "Security", label: "Shared-device session idle timeout (minutes)", restricted: true },
  /** Absolute session lifetime, standard and privileged (A-SEC-10). */
  "session.absolute_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(90 * 24), default: 7 * 24, assumption: "A-SEC-10", group: "Security", label: "Session absolute lifetime (hours)", restricted: true },
  "session.absolute_hours_privileged": { scopes: ["organization"], schema: z.number().int().min(1).max(7 * 24), default: 24, assumption: "A-SEC-10", group: "Security", label: "Privileged session absolute lifetime (hours)", restricted: true },
  /** Sessions are deleted this many days after expiry or revocation (A-SEC-11). */
  "session.purge_after_days": { scopes: ["organization"], schema: z.number().int().min(1).max(3650), default: 30, assumption: "A-SEC-11", group: "Security", label: "Delete ended sessions after (days)", restricted: true },
  /** Restricted actions need a password (and TOTP when enrolled) re-entry within this window (A-SEC-12). */
  "identity.reauth_window_minutes": { scopes: ["organization"], schema: z.number().int().min(1).max(120), default: 10, assumption: "A-SEC-12", group: "Security", label: "Re-authentication window (minutes)", restricted: true },
  /** Days a privileged user may work before TOTP enrolment is enforced (A-SEC-13). */
  "identity.mfa.grace_days": { scopes: ["organization"], schema: z.number().int().min(0).max(90), default: 7, assumption: "A-SEC-13", group: "Security", label: "Days before two-step sign-in is enforced", restricted: true },
  "identity.invitation.ttl_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(14 * 24), default: 72, assumption: "docs/security.md §3.8", group: "Security", label: "Invitation link lifetime (hours)", restricted: true },
  "identity.password_reset.ttl_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(24 * 60), default: 30, assumption: "docs/security.md §3.8", group: "Security", label: "Password reset link lifetime (minutes)", restricted: true },
  /** Password rules: length-based, no composition rules (A-SEC-03); reuse of the last N hashes refused (A-SEC-05). */
  "identity.password.min_length": { scopes: ["organization"], schema: z.number().int().min(8).max(64), default: 12, assumption: "A-SEC-03", group: "Security", label: "Minimum password length", restricted: true },
  /**
   * A role carrying restricted (R) permissions the granting administrator does not hold can be granted
   * only by owner_director ("grant requires owner approval", permissions-matrix §2). false lets any holder
   * of identity.site_assignment.admin grant it (still audited with the restricted list).
   */
  "identity.assignment.restricted_grant_requires_owner": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-W2E-02", group: "Security", label: "Restricted role grants need the owner", restricted: true },
  "identity.password.history_count": { scopes: ["organization"], schema: z.number().int().min(0).max(24), default: 5, assumption: "A-SEC-05", group: "Security", label: "Refuse reuse of the last N passwords", restricted: true },
  "inventory.expiry.alert_days": {
    scopes: ["organization"],
    schema: z.array(z.number().int().min(1).max(3650)).min(1).max(6),
    default: [30, 60, 90] as number[],
    assumption: "A-KPI-03",
    group: "Inventory",
    label: "Near-expiry alert buckets (days)",
  },

  // Wave 2 W2F: governance and operations (US-1-14, US-1-25, US-1-26, US-2-30).
  /**
   * US-2-30 read-only maintenance mode (A-DEP-21, runbook §17a.2): while enabled every command from
   * a user holding none of the allowed roles is refused before any write; reads and sign-in work.
   */
  "platform.maintenance.read_only": {
    scopes: ["organization"],
    schema: MaintenanceSchema,
    default: { enabled: false, allowed_role_codes: [] } as { enabled: boolean; allowed_role_codes: string[] },
    assumption: "A-DEP-21",
    group: "Maintenance",
    label: "Read-only maintenance mode",
    description: "While on, only users holding one of the allowed roles can change data; everyone sees a banner. Distinct from MAINTENANCE_MODE=1 (full outage for restores).",
    restricted: true,
  },
  /** A-SEC-14 rate limits (docs/security.md §4.5), enforced by the shared Postgres store (src/lib/rate-limit). */
  "platform.rate_limits": {
    scopes: ["organization"],
    schema: RateLimitSchema,
    default: { api_per_minute: 600, scan_lookups_per_minute: 120, login_ip_per_minute: 20, login_ip_per_hour: 200 } as z.infer<typeof RateLimitSchema>,
    assumption: "A-SEC-14",
    group: "Security",
    label: "Rate limits",
    description: "Requests per minute per signed-in user (API), scan look-ups per minute per user, and sign-in attempts per network address.",
    requiresApproval: true,
  },
  /** A-PM-14: configurable separation of duties for `approval?` record types (docs/permissions-matrix.md §5.1). */
  "approvals.sod.sales_order": sodSetting("Separation of duties: sales order confirmation"),
  "approvals.sod.quote": sodSetting("Separation of duties: quotes"),
  "approvals.sod.work_order_release": sodSetting("Separation of duties: work order release"),
  "approvals.sod.production_plan": sodSetting("Separation of duties: production plans"),
  "approvals.sod.customer_return": sodSetting("Separation of duties: customer returns"),
  /** Alert thresholds evaluated by `platform.alerts_evaluate` (docs/deployment-railway.md §8.3, A-DEP-11). */
  "alerts.worker_heartbeat_max_seconds": { scopes: ["organization"], schema: z.number().int().min(60).max(86_400), default: 300, assumption: "A-DEP-11", group: "Alerts", label: "Worker silent after (seconds)" },
  "alerts.backup_max_age_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(24 * 14), default: 26, assumption: "A-DEP-11", group: "Alerts", label: "Backup older than (hours)" },
  "alerts.failed_jobs_window_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(1440), default: 15, assumption: "A-DEP-11", group: "Alerts", label: "Dead-lettered job look-back (minutes)" },
  "alerts.dedupe_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(1440), default: 60, assumption: "A-DEP-11", group: "Alerts", label: "Repeat an open alert after (minutes)" },
  "platform.metrics.retention_days": { scopes: ["organization"], schema: z.number().int().min(7).max(730), default: 90, assumption: "A-DEP-11", group: "Platform", label: "Keep metrics samples (days)" },
  // Wave 2 W2A: production planning, work orders, staging and the production board (E-3-03, E-5-07)
  /** Batches without a work order (legacy/service callers). Off: batches come from work orders (W05-03); tests that need direct creation turn it on explicitly. */
  "production.batch.allow_without_work_order": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-W2A-01", group: "Production", label: "Allow batches without a work order", requiresApproval: true },
  /** Release a work order although some materials could not be reserved (W05-04: default off). */
  "production.work_order.allow_release_with_shortage": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "W05-04", group: "Production", label: "Release work orders with material shortages", requiresApproval: true },
  /** A reserved lot must expire more than this many days after the work order's planned end (W05-04 "configurable margin"). */
  "production.work_order.lot_expiry_margin_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(3650), default: 0, assumption: "A-W2A-02", group: "Production", label: "Reserved lot must outlive the planned end by (days)" },
  /** Work order reservations lapse this many days after the planned end unless staged or released earlier. */
  "production.work_order.reservation_grace_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(365), default: 3, assumption: "A-W2A-03", group: "Production", label: "Work order reservations lapse after planned end (days)" },
  /** Location kinds that count as a production staging area (scan destination at W05-05). */
  "production.staging.location_kinds": { scopes: ["organization", "site"], schema: z.array(z.string().min(1)).min(1).max(5), default: ["production"] as string[], assumption: "A-W2A-04", group: "Production", label: "Staging location kinds" },
  /** Staged stock stays reserved for its batch this long (hours) unless consumed or released earlier. */
  "production.staging.reservation_ttl_hours": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(24 * 90), default: 168, assumption: "A-W2A-05", group: "Production", label: "Staged stock reserved for (hours)" },
  /** Optional approval gate on production plans before lines become work orders (A-PROC-30: off by default). */
  "production.production_plan.approval_required": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-PROC-30", group: "Production", label: "Production plans need approval", requiresApproval: true },
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
    assumption: "A-UX-12", group: "Production", label: "Production board columns",
  },
  // Wave 3 W3D: customers, price lists, quotations and sales orders (US-4-01..US-4-06)
  /** Sales tax on quotes and orders, in percent of the subtotal. 0 = no tax line. Set only after the company's accountant reviews it (A-W3D-01). */
  "sales.tax.rate_pct": {
    scopes: ["organization"], schema: z.number().min(0).max(100), default: 0, assumption: "A-W3D-01", group: "Sales", label: "Sales tax rate on quotes and orders (%)",
    description: "Tax rules are configuration validated by the company's accountant; the system does not decide which tax applies. 0 shows no tax line.", requiresApproval: true, restricted: true,
  },
  /** Customers without a credit limit: auto-confirm (false) or always need credit approval (true) (A-W3D-02). */
  "sales.credit_check.require_limit": { scopes: ["organization"], schema: z.boolean(), default: false, assumption: "A-W3D-02", group: "Sales", label: "Orders of customers without a credit limit need approval", requiresApproval: true },
  /** Order quantity below the customer's approved MOQ requirement: warn on the order, or block submission (US-4-05 AC1). */
  "sales.order.moq_policy": { scopes: ["organization"], schema: z.enum(["warn", "block"]), default: "warn" as "warn" | "block", assumption: "A-W3D-04", group: "Sales", label: "Order below the customer's minimum order quantity" },
  /** Lines without an approved price-list price: allow a manual price (recorded as price source "manual") or refuse. */
  "sales.order.allow_manual_price": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-W3D-05", group: "Sales", label: "Allow manual prices when no price list applies", requiresApproval: true },
  /** Default validity of a new quotation (days from today). */
  "sales.quote.validity_days": { scopes: ["organization"], schema: z.number().int().min(1).max(365), default: 30, assumption: "A-W3D-06", group: "Sales", label: "Quotation valid for (days)" },
} as const satisfies Record<string, SettingDefinition>;

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

/* ---------------------------------------------------------------- registry helpers (W2F) */

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function settingDefinition(key: string): SettingDefinition | null {
  return isSettingKey(key) ? (SETTINGS[key] as SettingDefinition) : null;
}

/** The stored value at exactly this scope (no fallback), or null when no row exists. */
export async function readStoredSetting(q: DbOrTx, organizationId: string, key: string, siteId?: string | null): Promise<{ id: string; value: unknown } | null> {
  const [row] = await q
    .select({ id: settings.id, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.organizationId, organizationId),
        eq(settings.key, key),
        siteId ? and(eq(settings.scope, "site"), eq(settings.siteId, siteId)) : and(eq(settings.scope, "organization"), isNull(settings.siteId)),
        isNull(settings.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Writes (or removes, when `value` is null) the stored row of a setting at organization or site
 * scope. Only the governance service calls this, after permission, re-authentication, validation
 * and approval checks; it writes no audit itself.
 */
export async function writeStoredSetting(
  q: DbOrTx,
  a: { organizationId: string; key: SettingKey; siteId?: string | null; value: unknown; updatedBy: string },
): Promise<void> {
  const existing = await readStoredSetting(q, a.organizationId, a.key, a.siteId);
  if (a.value === null || a.value === undefined) {
    if (existing) await q.delete(settings).where(eq(settings.id, existing.id));
    return;
  }
  const parsed = (SETTINGS[a.key] as SettingDefinition).schema.parse(a.value);
  if (existing) {
    await q.update(settings).set({ value: parsed as object, updatedBy: a.updatedBy, updatedAt: new Date() }).where(eq(settings.id, existing.id));
  } else {
    await q.insert(settings).values({
      organizationId: a.organizationId,
      scope: a.siteId ? "site" : "organization",
      siteId: a.siteId ?? null,
      key: a.key,
      value: parsed as object,
      updatedBy: a.updatedBy,
    });
  }
}

/** Every stored organization/site row (for the admin screen; unknown keys are listed as orphans). */
export async function listStoredSettings(q: DbOrTx, organizationId: string) {
  return q
    .select({ id: settings.id, scope: settings.scope, siteId: settings.siteId, key: settings.key, value: settings.value, updatedBy: settings.updatedBy, updatedAt: settings.updatedAt })
    .from(settings)
    .where(and(eq(settings.organizationId, organizationId), isNull(settings.userId)));
}
