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
  // Product families moved to the editable list `product_family` (Master data → Lists, ADR-076; src/db/sql/s4.sql copies a stored value).

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
  /**
   * A-PROC-08, ADR-080 §7: finished-lot expiry basis plus product shelf life. `mixing_date` (default for
   * new organizations, A-PF2-24) = the day the first making step after weighing started (Mix and pour),
   * which is also the manufacture date on the lot; `manufacture_date` = batch start date (Start check);
   * `packaging_date` = packaging-step completion. Existing organizations keep `manufacture_date`
   * (src/db/sql/g2.sql stores it for them).
   */
  "production.output.expiry_basis": {
    scopes: ["organization"],
    schema: z.enum(["mixing_date", "manufacture_date", "packaging_date"]),
    default: "mixing_date" as "mixing_date" | "manufacture_date" | "packaging_date",
    assumption: "A-PROC-08, A-PF2-24",
    group: "Production",
    label: "Finished-lot expiry counts from",
    description: "Mixing date (recommended): the day the batch was mixed. Batch start date: the day of the Start check. Packaging date: the day wrapping or filling finished. The regulatory adviser confirms the basis.",
    requiresApproval: true,
  },
  /** ADR-080 §2 (V-2-3): with this off the Materials list ticks move no stock; on = every tick posts the move to the production area (staging transfer). */
  "production.prepare.move_stock": {
    scopes: ["organization", "site"],
    schema: z.boolean(),
    default: false as boolean,
    assumption: "A-PF2-02",
    group: "Production",
    label: "Materials list moves stock to the production area",
    description: "Off: ticking Taken only records who brought the material. On: each tick also moves the set-aside lot to the production area in the stock ledger (use when the store room is in another building).",
    requiresApproval: true,
  },
  /** ADR-080 §2: the Materials list asks for a scan of the lot label before Taken. The lot is always confirmed again at weighing. */
  "production.prepare.scan_lots": {
    scopes: ["organization", "site"],
    schema: z.boolean(),
    default: false as boolean,
    assumption: "A-PF2-20",
    group: "Production",
    label: "Materials list asks to scan each lot",
    description: "Off: one tap on Taken. On: the lot label must be scanned (or typed) and match the set-aside lot.",
  },
  /** ADR-080 §3 (UX review B5): how the operator confirms the preselected lot on the Weigh card. */
  "production.weighing.lot_confirm": {
    scopes: ["organization", "site"],
    schema: z.enum(["last4", "scan", "none"]),
    default: "last4" as "last4" | "scan" | "none",
    assumption: "A-PF2-11",
    group: "Production",
    label: "Confirm the lot at weighing",
    description: "Last 4 (recommended): type the last 4 characters printed on the container label. Scan: scan the lot label. None: no confirmation (GMP adviser must agree).",
    requiresApproval: true,
    restricted: true,
  },
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
  /**
   * Owner decision 2026-10-25 (ADR-078): a checker or approver signing on the operator's device picks
   * their name; their password is asked only when this is on. The record still names the signer and the
   * session it was entered from (audit `identity.co_signature.by_name`), but it no longer proves the
   * signer was present — flagged for qualified review (GMP second-person checks).
   */
  "production.sign_off.require_password": {
    scopes: ["organization"],
    schema: z.boolean(),
    default: false as boolean,
    assumption: "A-SIGN-01",
    group: "Production",
    label: "Checker types their password to sign",
    description: "Off: the checker or approver just picks their name on the tablet (fast). On: they also type their own password, which proves they were there.",
    restricted: true,
  },
  /**
   * ADR-078, ADR-080 §4: second-person check of weighings. `all` = every ingredient; `marked` = only
   * formula lines marked "needs a check" (`bom_lines.requires_checker`); `none` = the operator weighs
   * alone (the log still shows who). Stored booleans from before ADR-080 still read: true → all,
   * false → none (src/db/sql/g2.sql rewrites them). Frozen into the batch snapshot at creation.
   */
  "production.weighing.second_person_check": {
    scopes: ["organization", "site"],
    schema: z.preprocess((v) => (v === true ? "all" : v === false ? "none" : v), z.enum(["all", "marked", "none"])),
    default: "marked" as "all" | "marked" | "none",
    assumption: "A-SIGN-02, A-PF2-08",
    group: "Production",
    label: "Second person checks weighings",
    description: "All ingredients, only the ingredients marked \"needs a check\" in the formula (recommended: lye solution, colour, extract, fragrance, preservative), or none. Applies to batches created after the change.",
    requiresApproval: true,
  },
  /**
   * ADR-073: the owner may carry any step through alone. When on, a user holding the Owner/Director role
   * holds every permission and passes every separation-of-duties check (second person, checker,
   * approver other than the submitter); each use is audited as `governance.owner_override.used`.
   * Off by default for a real company because QA release and second-person checks are regulatory
   * controls (ISO 22716 / FDA Philippines GMP) — flagged for qualified review before switching it on.
   * On in the demo and the sandbox (src/db/seed.ts, src/db/sandbox.ts).
   */
  "governance.owner_override": {
    scopes: ["organization"],
    schema: z.boolean(),
    default: false as boolean,
    assumption: "A-GOV-OWNER",
    group: "Approvals",
    label: "Owner can do every step alone (owner override)",
    description: "When on, the Owner/Director can do any step, including approvals and checks that normally need a different person or another role (for example QA release). Every such step is recorded in the audit log as an owner override. Quality and GMP rules normally require an independent second person: confirm with your QA adviser before switching this on for real production.",
    restricted: true,
  },
  /** Alert thresholds evaluated by `platform.alerts_evaluate` (docs/deployment-railway.md §8.3, A-DEP-11). */
  "alerts.worker_heartbeat_max_seconds": { scopes: ["organization"], schema: z.number().int().min(60).max(86_400), default: 300, assumption: "A-DEP-11", group: "Alerts", label: "Worker silent after (seconds)" },
  "alerts.backup_max_age_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(24 * 14), default: 26, assumption: "A-DEP-11", group: "Alerts", label: "Backup older than (hours)" },
  "alerts.failed_jobs_window_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(1440), default: 15, assumption: "A-DEP-11", group: "Alerts", label: "Dead-lettered job look-back (minutes)" },
  "alerts.dedupe_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(1440), default: 60, assumption: "A-DEP-11", group: "Alerts", label: "Repeat an open alert after (minutes)" },
  "alerts.restore_drill_max_age_days": { scopes: ["organization"], schema: z.number().int().min(7).max(400), default: 100, assumption: "A-W4F-05", group: "Alerts", label: "Restore drill overdue after (days)", description: "W4F: the owner is reminded in-app when the newest restore drill is older than this (quarterly drills, docs/deployment-railway.md §10). Checked only when BACKUP_STATUS_SOURCE=table." },
  "platform.metrics.retention_days": { scopes: ["organization"], schema: z.number().int().min(7).max(730), default: 90, assumption: "A-DEP-11", group: "Platform", label: "Keep metrics samples (days)" },
  // Wave 4 W4F: retention sweep (US-9-05, docs/data-model.md §12.4). Report-only until the owner switches it.
  "platform.retention.sweep_mode": {
    scopes: ["organization"],
    schema: z.enum(["report", "execute"]),
    default: "report" as "report" | "execute",
    assumption: "A-W4F-03",
    group: "Retention",
    label: "Weekly retention sweep",
    description: "report = the weekly sweep only writes a dry-run report; execute = it deletes rows of confirmed delete policies (never held records, never ledgers or audit).",
    restricted: true,
    requiresApproval: true,
  },
  "platform.retention.max_rows_per_target": { scopes: ["organization"], schema: z.number().int().min(100).max(200_000), default: 10_000, assumption: "A-W4F-04", group: "Retention", label: "Rows deleted per target per run", description: "Caps one run so a purge never holds long locks; the next run continues." },
  // Wave 2 W2A: production planning, work orders, staging and the production board (E-3-03, E-5-07)
  /** Batches without a work order (legacy/service callers). Off: batches come from work orders (W05-03); tests that need direct creation turn it on explicitly. */
  "production.batch.allow_without_work_order": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-W2A-01", group: "Production", label: "Allow batches without a work order", requiresApproval: true },
  /** Release a work order although some materials could not be reserved (W05-04: default off). */
  "production.work_order.allow_release_with_shortage": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "W05-04", group: "Production", label: "Release work orders with material shortages", requiresApproval: true },
  /** A reserved lot must expire more than this many days after the work order's planned end (W05-04 "configurable margin"). */
  "production.work_order.lot_expiry_margin_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(3650), default: 0, assumption: "A-W2A-02", group: "Production", label: "Reserved lot must outlive the planned end by (days)" },
  /** Work order reservations lapse this many days after the planned end unless staged or released earlier. */
  "production.work_order.reservation_grace_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(365), default: 3, assumption: "A-W2A-03", group: "Production", label: "Work order reservations lapse after planned end (days)" },
  /** ADR-074 (S2): defect types operators pick in the production order daily log (A-S2-02, owner-editable list). */
  "production.defect_types": {
    scopes: ["organization", "site"],
    schema: z.array(z.string().trim().min(1).max(40)).min(1).max(30).refine((v) => new Set(v.map((x) => x.toLowerCase())).size === v.length, "Each reject type once."),
    default: ["Cracked bar", "Wrong weight", "Air bubbles", "Discoloration", "Bad wrapping", "Other"] as string[],
    assumption: "A-S2-02",
    group: "Production",
    label: "Reject types for the daily log",
    description: "The list operators choose from when they record rejects (the key keeps its name production.defect_types). Removing a type keeps old entries as they were.",
  },
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
  // (W4B: the former `sales.tax.rate_pct` moved to the reviewed tax configuration; see finance.tax.default_sales_code.)
  /** Customers without a credit limit: auto-confirm (false) or always need credit approval (true) (A-W3D-02). */
  "sales.credit_check.require_limit": { scopes: ["organization"], schema: z.boolean(), default: false, assumption: "A-W3D-02", group: "Sales", label: "Orders of customers without a credit limit need approval", requiresApproval: true },
  /** Order quantity below the customer's approved MOQ requirement: warn on the order, or block submission (US-4-05 AC1). */
  "sales.order.moq_policy": { scopes: ["organization"], schema: z.enum(["warn", "block"]), default: "warn" as "warn" | "block", assumption: "A-W3D-04", group: "Sales", label: "Order below the customer's minimum order quantity" },
  /** Lines without an approved price-list price: allow a manual price (recorded as price source "manual") or refuse. */
  "sales.order.allow_manual_price": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-W3D-05", group: "Sales", label: "Allow manual prices when no price list applies", requiresApproval: true },
  /** Default validity of a new quotation (days from today). */
  "sales.quote.validity_days": { scopes: ["organization"], schema: z.number().int().min(1).max(365), default: 30, assumption: "A-W3D-06", group: "Sales", label: "Quotation valid for (days)" },
  // Wave 3 W3E: boxing and fulfilment (US-4-07..14). Defaults need owner / process-owner confirmation.
  /** A-PROC-38: after the first verified pack of a SKU (all boxes), the checker scans this many boxes. */
  "inventory.pack.verification_sample_size": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(500), default: 3, assumption: "A-PROC-38", group: "Fulfilment", label: "Pack verification sample (boxes)", requiresApproval: true },
  /** A-W3E-01: a scanned box that is not the allocated one may replace it when it holds the same lot and quantity. */
  "sales.pick.substitution": { scopes: ["organization", "site"], schema: z.enum(["none", "same_lot"]), default: "same_lot" as "none" | "same_lot", assumption: "A-W3E-01", group: "Fulfilment", label: "Pick substitution rule", requiresApproval: true },
  /** A-W3E-02: dispatch straight from the allocation without pick and pack verification (MVP path). Off: AC-17. */
  "sales.fulfilment.direct_dispatch_allowed": { scopes: ["organization", "site"], schema: z.boolean(), default: false, assumption: "A-W3E-02", group: "Fulfilment", label: "Allow dispatch without pick and pack verification", requiresApproval: true },
  /** A-RPT-13: copies printed per delivery receipt (Customer, Driver, File). */
  "documents.delivery_receipt.copies": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(5), default: 3, assumption: "A-RPT-13", group: "Documents and labels", label: "Delivery receipt copies" },
  /** A-RPT-12: statutory / commercial wording printed on the DR; content validated by the accountant. Empty = none. */
  "documents.delivery_receipt.statutory_text": { scopes: ["organization", "site"], schema: z.string().max(600), default: "", assumption: "A-RPT-12", group: "Documents and labels", label: "Delivery receipt statutory wording (accountant-validated)", requiresApproval: true },
  "documents.delivery_receipt.template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "DR-STD", assumption: "A-W3E-03", group: "Documents and labels", label: "Delivery receipt template code" },
  "documents.pick_list.template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "PICK-LIST", assumption: "A-W3E-03", group: "Documents and labels", label: "Pick list template code" },
  "documents.boxing_note.template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "BOXING-NOTE", assumption: "A-W3E-03", group: "Documents and labels", label: "Boxing note / packing list template code" },
  /** W09 exception path: unacknowledged delivery receipts older than this appear in the action centre. */
  "sales.delivery_receipt.unacknowledged_days": { scopes: ["organization", "site"], schema: z.number().int().min(1).max(60), default: 3, assumption: "A-W3E-04", group: "Fulfilment", label: "Remind about unacknowledged delivery receipts after (days)" },
  /** A-W3E-05: largest acknowledgment image embedded in the regenerated DR (bigger files are kept and referenced). */
  "documents.delivery_receipt.max_embedded_image_kb": { scopes: ["organization"], schema: z.number().int().min(50).max(4096), default: 1024, assumption: "A-W3E-05", group: "Documents and labels", label: "Largest signature/photo embedded in a DR (KB)" },

  // Wave 3 W3F: complaints, customer returns and the recall explorer (E-4-05). Every list is the company's
  // QA configuration (A-W3F-nn in docs/PRD.md); the defaults are placeholders for QA to confirm or replace.
  /** Complaint categories offered when a complaint is logged (W07-06). */
  "quality.complaint.categories": {
    scopes: ["organization"],
    schema: z.array(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), label: z.string().min(1).max(60) }).strict()).min(1).max(30),
    default: [
      { code: "product_quality", label: "Product quality (appearance, smell, texture)" },
      { code: "packaging", label: "Packaging or container" },
      { code: "labelling", label: "Label or printed information" },
      { code: "quantity", label: "Quantity or count" },
      { code: "foreign_matter", label: "Foreign matter" },
      { code: "skin_reaction", label: "Reported skin or health reaction" },
      { code: "delivery", label: "Delivery or documents" },
      { code: "other", label: "Other" },
    ] as { code: string; label: string }[],
    assumption: "A-W3F-01", group: "Quality", label: "Complaint categories", requiresApproval: true,
  },
  /** Complaint severity classes qa_qc chooses from; their meaning is the company's QA definition. */
  "quality.complaint.severity_levels": {
    scopes: ["organization"],
    schema: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).min(1).max(10),
    default: ["minor", "major", "critical"] as string[],
    assumption: "A-W3F-02", group: "Quality", label: "Complaint severity levels", requiresApproval: true,
  },
  /** Severities that flag the complaint for a recall assessment and notify QA and the owner. A prompt only: the recall decision stays with people (W07-08, A-PROC-25). */
  "quality.complaint.recall_review_severities": {
    scopes: ["organization"],
    schema: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).max(10),
    default: ["critical"] as string[],
    assumption: "A-W3F-03", group: "Quality", label: "Complaint severities that prompt a recall assessment", requiresApproval: true,
  },
  /** When the customer has recorded shipments, the lot or box named must be among them (W07-06 "validated against shipments to that customer when known"). */
  "quality.complaint.require_shipment_match": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-W3F-04", group: "Quality", label: "Complaint lot must match a shipment to the customer" },
  /**
   * Location kinds a customer return may be received into (V-LOC: the returns location, status quarantine). The
   * inventory location-class rule (allowedDestinationKinds) applies on top, so `recall` takes effect only once
   * recall locations accept quarantined stock (recall cases, Phase 6).
   */
  "sales.customer_return.location_kinds": {
    scopes: ["organization", "site"],
    schema: z.array(z.enum(["quarantine", "hold", "recall"])).min(1).max(3),
    default: ["quarantine"] as ("quarantine" | "hold" | "recall")[],
    assumption: "A-W3F-05", group: "Sales", label: "Customer returns are received into location kinds",
  },
  // Wave 3 W3C: import wizard and go-live loader (docs/data-migration-plan.md §9, docs/security.md §2.6)
  "platform.imports.max_rows": { scopes: ["organization"], schema: z.number().int().min(1).max(100_000), default: 100_000, assumption: "A-SEC-18", group: "Imports", label: "Maximum rows per import file", description: "Files with more data rows are refused at upload." },
  "platform.imports.max_file_mb": { scopes: ["organization"], schema: z.number().int().min(1).max(20), default: 20, assumption: "A-SEC-15", group: "Imports", label: "Maximum import file size (MB)" },
  "platform.imports.chunk_size": { scopes: ["organization"], schema: z.number().int().min(10).max(5_000), default: 500, assumption: "A-W3C-01", group: "Imports", label: "Rows per posting transaction", description: "Validation and posting run in chunks of this many rows; a restart continues with the rows not yet posted." },
  "platform.imports.inline_row_limit": { scopes: ["organization"], schema: z.number().int().min(0).max(5_000), default: 200, assumption: "A-W3C-02", group: "Imports", label: "Run small imports immediately (rows)", description: "Files up to this many rows are validated and posted in the request; larger files run in the background worker." },
  "platform.imports.require_second_person": {
    scopes: ["organization"],
    schema: z.boolean(),
    default: true as boolean,
    assumption: "A-W3C-03",
    group: "Imports",
    label: "Import approver must differ from the uploader",
    description: "When on, the person who uploaded or submitted an import cannot approve it (docs/data-migration-plan.md §9.1, §9.4).",
    requiresApproval: true,
  },
  "imports.opening_stock.status_rules": {
    scopes: ["organization", "site"],
    schema: z
      .object({
        expiryRequiredClasses: z.array(z.enum(["raw_material", "intermediate", "packaging", "consumable", "product"])).max(5),
        supplierLotRequiredClasses: z.array(z.enum(["raw_material", "intermediate", "packaging", "consumable", "product"])).max(5),
      })
      .strict(),
    default: { expiryRequiredClasses: ["raw_material", "intermediate", "product"], supplierLotRequiredClasses: ["raw_material"] } as {
      expiryRequiredClasses: ("raw_material" | "intermediate" | "packaging" | "consumable" | "product")[];
      supplierLotRequiredClasses: ("raw_material" | "intermediate" | "packaging" | "consumable" | "product")[];
    },
    assumption: "A-MIG-06",
    group: "Imports",
    label: "Opening stock: classes put on hold when expiry or supplier lot is missing",
    description: "Opening lots start in quarantine; past expiry → expired; missing expiry (or supplier lot) for these classes → on hold. QA confirms the lists before go-live; no lot is ever released by the import.",
    requiresApproval: true,
  },
  // Wave 3 W3B: reports, scheduled delivery, action centre (US-5-04..07, US-5-14)
  "reports.screen_rows": { scopes: ["organization"], schema: z.number().int().min(50).max(5000), default: 500, assumption: "A-W3B-01", group: "Reports", label: "Rows shown on screen per report", description: "More rows are in the CSV/XLSX export, which caps at the export row limit (A-RPT-18)." },
  "reports.file_retention_days": { scopes: ["organization"], schema: z.number().int().min(1).max(365), default: 30, assumption: "A-SEC-30", group: "Reports", label: "Keep scheduled report files (days)" },
  "reports.email_delivery": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-PRD-25", group: "Reports", label: "Email a link when a scheduled report is ready", description: "The email carries a link that needs sign-in, never the data itself." },
  "reports.access_report.recipient_role_codes": { scopes: ["organization"], schema: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1).max(10), default: ["owner_director"] as string[], assumption: "A-W3B-06", group: "Reports", label: "Weekly access-and-exceptions report goes to roles", restricted: true },
  "reports.access_report.restricted_actions": {
    scopes: ["organization"],
    schema: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/)).max(100),
    default: [
      "quality.disposition.approved",
      "quality.hold.lifted",
      "production.batch.reopened",
      "production.batch.amended",
      "identity.role.owner_break_glass",
      "identity.mfa.reset",
      "platform.setting.changed",
      "platform.setting_change_request.approved",
      "platform.numbering_rule.changed",
      "platform.approval_rule.changed",
      "platform.notification_rule.changed",
      "inventory.inventory_balance.rebuilt",
      "platform.database_session.break_glass_opened",
    ] as string[],
    assumption: "A-W3B-06",
    group: "Reports",
    label: "Actions listed as restricted-permission use",
    description: "Audit event names counted in the weekly access report (docs/security.md §5, restricted class).",
    restricted: true,
  },
  "reports.access_report.exception_actions": {
    scopes: ["organization"],
    schema: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/)).max(100),
    default: [
      "inventory.stock_movement.held_stock_issued",
      "production.dispense_record.over_tolerance_approved",
      "production.batch_material.substituted",
      "production.equipment_use.override_approved",
      "inventory.stock_movement.reversed",
      "procurement.goods_receipt.reversed",
      "procurement.goods_receipt.discrepancy_approved",
      "inventory.stock_adjustment.approved",
      "inventory.stock_count.variance_approved",
      "sales.shipment.over_shipment_approved",
    ] as string[],
    assumption: "A-W3B-06",
    group: "Reports",
    label: "Actions listed as controlled exceptions",
    restricted: true,
  },
  "action_centre.order_late_grace_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(60), default: 0, assumption: "A-W3B-07", group: "Action centre", label: "Order unshipped this many days after the requested date" },
  "action_centre.work_order_late_grace_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(60), default: 0, assumption: "A-W3B-07", group: "Action centre", label: "Work order late this many days after its planned end" },
  // Wave 3 W3A: KPI engine (docs/analytics-kpis.md §1.3, §8.1)
  "analytics.fefo_window_days": { scopes: ["organization"], schema: z.number().int().min(1).max(365), default: 30, assumption: "A-KPI-03", group: "Analytics", label: "FEFO risk window (days)", description: "A released lot with stock on hand counts as at FEFO risk when it expires within this many days (owner tile and inventory dashboard)." },
  "analytics.otif_grace_days": { scopes: ["organization"], schema: z.number().int().min(0).max(30), default: 0, assumption: "A-KPI-02", group: "Analytics", label: "OTIF grace days", description: "Days after the requested delivery date that a dispatch still counts as on time." },
  // Wave 4 W4B: operational finance (docs/modules/finance.md §10.1). Every value is a placeholder for owner / accountant confirmation.
  "finance.currency": { scopes: ["organization"], schema: z.string().regex(/^[A-Z]{3}$/), default: "PHP", assumption: "A-FIN-26", group: "Finance", label: "Document currency", description: "Single currency of invoices, bills and payments (ISO code). Multi-currency documents are out of scope.", requiresApproval: true },
  "finance.tax.default_sales_code": {
    scopes: ["organization"], schema: z.string().regex(/^[A-Z0-9_-]{1,20}$/).nullable(), default: null as string | null, assumption: "A-W4B-02", group: "Finance", label: "Tax code for sales (quotes, orders, invoice lines)",
    description: "A code of the reviewed tax configuration (Finance → Tax configuration). Empty = no tax line. The system does not decide which tax applies; the accountant does.", requiresApproval: true, restricted: true,
  },
  "finance.tax.default_purchase_code": {
    scopes: ["organization"], schema: z.string().regex(/^[A-Z0-9_-]{1,20}$/).nullable(), default: null as string | null, assumption: "A-W4B-02", group: "Finance", label: "Tax code for supplier bill lines",
    description: "A code of the reviewed tax configuration used as the default on new supplier bill lines. Empty = no input tax.", requiresApproval: true, restricted: true,
  },
  "finance.invoice.default_terms_days": { scopes: ["organization"], schema: z.number().int().min(0).max(365), default: 30, assumption: "A-FIN-04", group: "Finance", label: "Invoice due after (days) when the customer has no terms", requiresApproval: true },
  "finance.bill.default_terms_days": { scopes: ["organization"], schema: z.number().int().min(0).max(365), default: 30, assumption: "A-FIN-04", group: "Finance", label: "Bill due after (days) when the supplier has no terms", requiresApproval: true },
  "finance.payment.apply_oldest_first": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-FIN-07", group: "Finance", label: "Apply payments to the oldest due document first", description: "When a payment is recorded without a manual allocation, it settles the counterparty's open documents oldest due date first." },
  "finance.match.qty_tolerance_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 0, assumption: "A-FIN-08", group: "Finance", label: "Three-way match: quantity tolerance (%)", requiresApproval: true },
  "finance.match.price_tolerance_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 2, assumption: "A-FIN-08", group: "Finance", label: "Three-way match: price tolerance (%)", requiresApproval: true },
  "finance.match.price_tolerance_amount": { scopes: ["organization", "site"], schema: z.number().min(0).max(1_000_000), default: 100, assumption: "A-FIN-08", group: "Finance", label: "Three-way match: price tolerance per line (amount)", description: "The larger of the percentage and this amount applies.", requiresApproval: true },
  "finance.bill.no_po_categories": {
    scopes: ["organization"], schema: z.array(z.string().regex(/^[a-z_]{2,30}$/)).max(30), default: ["utilities", "services", "rent"] as string[], assumption: "A-FIN-09", group: "Finance", label: "Bill categories allowed without a PO or receipt",
    description: "Non-stock bills (utilities, services, rent) may be entered without a purchase order or goods receipt; they always need finance approval.", requiresApproval: true,
  },
  "finance.expense.categories": {
    scopes: ["organization"], schema: z.array(z.object({ code: z.string().regex(/^[a-z_]{2,30}$/), label: z.string().min(2).max(60) }).strict()).min(1).max(40),
    default: [
      { code: "travel", label: "Travel and fares" },
      { code: "meals", label: "Meals (business)" },
      { code: "supplies", label: "Office and plant supplies" },
      { code: "transport", label: "Delivery and courier" },
      { code: "other", label: "Other" },
    ] as { code: string; label: string }[],
    assumption: "A-FIN-22", group: "Finance", label: "Expense claim categories",
  },
  "finance.credit_note.reasons": {
    scopes: ["organization"], schema: z.array(z.object({ code: z.string().regex(/^[a-z_]{2,30}$/), label: z.string().min(2).max(80) }).strict()).min(1).max(30),
    default: [
      { code: "goods_returned", label: "Goods returned by the customer" },
      { code: "pricing_error", label: "Pricing or quantity error on the invoice" },
      { code: "damaged_goods", label: "Damaged or short-delivered goods (no return)" },
      { code: "invoice_void", label: "Invoice issued in error (full void)" },
      { code: "other", label: "Other (explain)" },
    ] as { code: string; label: string }[],
    assumption: "A-W4B-08", group: "Finance", label: "Credit note reasons",
  },
  "finance.expense.receipt_required_above": { scopes: ["organization"], schema: z.number().min(0).max(1_000_000), default: 500, assumption: "A-FIN-21", group: "Finance", label: "Receipt attachment required above (amount)", requiresApproval: true },
  "analytics.snapshot_stale_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(24 * 14), default: 48, assumption: "A-KPI-11", group: "Analytics", label: "Snapshot charts are stale after (hours)", description: "Trend and sparkline data older than this (twice the nightly cadence) shows a Stale badge." },
  // Wave 4 W4A: procurement (US-6-02..04, US-6-20, US-6-21; docs/process-maps.md W01, W04)
  "procurement.receipt.over_delivery_tolerance_pct": { scopes: ["organization", "site"], schema: z.number().min(0).max(100), default: 0, assumption: "A-PROC-11", group: "Procurement", label: "Over-delivery tolerance (% of the PO line)", description: "A PO receipt line may exceed the open quantity by this percentage without approval; above it the line needs an approved over-delivery discrepancy (V-OVER, CX-QTY)." },
  "procurement.purchase_order.late_grace_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(60), default: 0, assumption: "A-W4A-03", group: "Procurement", label: "PO is late this many days after its expected date", description: "Sent or partially received purchase orders past their expected (or promised) date plus these days appear as late in the action centre and in supplier on-time performance." },
  "procurement.purchase_order.email_supplier": { scopes: ["organization"], schema: z.boolean(), default: true, assumption: "A-W4A-04", group: "Procurement", label: "Email the PO summary to the supplier when sent", description: "The email carries the PO lines and dates as text (role titles only); the printable PO document is always recorded. Off = download and send by hand." },
  "procurement.reorder.expiry_window_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(365), default: 30, assumption: "A-W4A-05", group: "Procurement", label: "Reorder: stock expiring within lead time plus (days) counts as at risk", description: "Released stock expiring before the replenishment can arrive (lead time + this window) is not counted as cover in reorder suggestions." },
  "documents.purchase_order.template_code": { scopes: ["organization", "site"], schema: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), default: "PO-STD", assumption: "A-W4A-06", group: "Documents", label: "Purchase order document template" },
  "analytics.forecast.horizon_months": { scopes: ["organization"], schema: z.number().int().min(1).max(12), default: 3, assumption: "A-KPI-13", group: "Analytics", label: "Forecast horizon (months)" },
  "analytics.forecast.ses_alpha": { scopes: ["organization"], schema: z.number().min(0.05).max(0.95), default: 0.3, assumption: "A-KPI-13", group: "Analytics", label: "Exponential smoothing alpha", description: "Weight of the latest month in the simple exponential smoothing baseline (docs/analytics-kpis.md §6.2)." },
  "analytics.forecast.history_months": { scopes: ["organization"], schema: z.number().int().min(6).max(60), default: 36, assumption: "A-KPI-13", group: "Analytics", label: "Forecast history used (months)" },
  "approvals.sod.forecast_override": sodSetting("Separation of duties: forecast overrides"),
  // Wave 4 W4C: CAPA, change control, recall cases, equipment maintenance (US-6-18, US-6-19; A-W4C-nn in docs/PRD.md).
  // Every value is a placeholder for the company's QA / maintenance lead to confirm or replace; none is a regulatory rule.
  /** Days after "Submit for closure" before the CAPA effectiveness check may be recorded (QA may set a later date per CAPA). */
  "quality.capa.effectiveness_check_days": {
    scopes: ["organization", "site"], schema: z.number().int().min(0).max(730), default: 30,
    assumption: "A-W4C-01", group: "Quality", label: "CAPA effectiveness check after (days)", description: "Placeholder; the company's QA defines how long to wait before judging whether a CAPA worked.", requiresApproval: true,
  },
  /** Risk levels QA chooses from when assessing a change control (their meaning is the company's QA definition). */
  "quality.change_control.risk_levels": {
    scopes: ["organization"], schema: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).min(1).max(10), default: ["low", "medium", "high"] as string[],
    assumption: "A-W4C-02", group: "Quality", label: "Change control risk levels", requiresApproval: true,
  },
  /**
   * Wording of the customer recall / withdrawal notice that sales_cs sends (printed with the notification list).
   * The default is a placeholder that must be replaced by text approved by QA / regulatory personnel.
   */
  "quality.recall_case.notice_text": {
    scopes: ["organization"], schema: z.string().min(10).max(4000),
    default: "PLACEHOLDER: replace with the recall / withdrawal notice wording approved by the company's QA and regulatory personnel before any real notification is sent." as string,
    assumption: "A-W4C-03", group: "Quality", label: "Recall notice wording", requiresApproval: true,
  },
  /** Days before a PM plan's due date that it shows as due soon in the action centre (a plan's own lead days win). */
  "maintenance.pm.due_soon_days": { scopes: ["organization", "site"], schema: z.number().int().min(0).max(90), default: 7, assumption: "A-W4C-04", group: "Maintenance", label: "PM plan due soon (days before due)" },
  /** Share of a usage-based interval at which the plan shows as due soon (e.g. 90 = at 90 % of the interval). */
  "maintenance.pm.usage_due_soon_pct": { scopes: ["organization", "site"], schema: z.number().int().min(50).max(100), default: 90, assumption: "A-W4C-04", group: "Maintenance", label: "Usage-based PM due soon at (% of interval)" },
  // Wave 4 W4E: customer portal (US-8-01, US-8-02; docs/security.md §2.10, §3.4, §4.5; docs/permissions-matrix.md §7)
  "portal.session.idle_minutes": { scopes: ["organization"], schema: z.number().int().min(5).max(24 * 60), default: 30, assumption: "A-W4E-03", group: "Customer portal", label: "Portal session idle timeout (minutes)", restricted: true },
  "portal.session.absolute_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(7 * 24), default: 24, assumption: "A-W4E-03", group: "Customer portal", label: "Portal session absolute lifetime (hours)", restricted: true },
  "portal.auth.max_failed_attempts": { scopes: ["organization"], schema: z.number().int().min(3).max(20), default: 5, assumption: "A-W4E-03", group: "Customer portal", label: "Failed portal sign-ins before the account locks", description: "Bryel's Care staff unlock a locked portal account from the customer's Portal access panel.", restricted: true },
  "portal.rate_limits": {
    scopes: ["organization"],
    schema: z.object({ unauthenticated_per_minute: z.number().int().min(5).max(10_000), authenticated_per_minute: z.number().int().min(10).max(10_000) }).strict(),
    default: { unauthenticated_per_minute: 30, authenticated_per_minute: 120 },
    assumption: "A-W4E-03",
    group: "Customer portal",
    label: "Portal request limits",
    description: "Unauthenticated portal requests (sign-in, invitation) per client IP and minute; signed-in portal requests per portal user and minute.",
    restricted: true,
  },
  "portal.invitation.ttl_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(14 * 24), default: 72, assumption: "A-W4E-03", group: "Customer portal", label: "Portal invitation link lifetime (hours)" },
  "portal.order.max_lines": { scopes: ["organization"], schema: z.number().int().min(1).max(200), default: 30, assumption: "A-W4E-04", group: "Customer portal", label: "Most lines in one portal order", description: "Order size cap against abuse (docs/security.md §2.10); larger orders go through the sales team." },
  "portal.order.max_qty_per_line": { scopes: ["organization"], schema: z.number().int().min(1).max(10_000_000), default: 50_000, assumption: "A-W4E-04", group: "Customer portal", label: "Most pieces per portal order line" },
  // Wave 4 W4D: offline operation (docs/offline-sync.md §1, §2, §4.1; ADR-018). Defaults are the A-OFF assumptions.
  "offline.auth_snapshot_max_age_hours": {
    scopes: ["organization"],
    schema: z.number().int().min(1).max(72),
    default: 12,
    assumption: "A-OFF-02",
    group: "Offline",
    label: "Offline sign-in snapshot valid for (hours)",
    description: "After this long without reaching the server a device cannot queue new offline work; queued work recorded with an older snapshot goes to conflict review.",
    requiresApproval: true,
  },
  "offline.retry_schedule_seconds": {
    scopes: ["organization"],
    schema: z.array(z.number().int().min(1).max(86_400)).min(1).max(10),
    default: [5, 30, 120, 600, 1800] as number[],
    assumption: "A-OFF-08",
    group: "Offline",
    label: "Retry waits after a failed send (seconds)",
    description: "Waits after each failed attempt to reach the server; the last value repeats. Each wait is jittered by ±20 %.",
  },
  "offline.max_attempts": { scopes: ["organization"], schema: z.number().int().min(1).max(100), default: 20, assumption: "A-OFF-08", group: "Offline", label: "Send attempts before a change shows as failed" },
  "offline.max_queue_age_hours": {
    scopes: ["organization"],
    schema: z.number().int().min(1).max(24 * 30),
    default: 72,
    assumption: "A-OFF-09",
    group: "Offline",
    label: "Queued work needs review after (hours)",
    description: "Offline work older than this when it reaches the server is parked for review instead of applied. Never shorter than the snapshot validity.",
    requiresApproval: true,
  },
  "offline.full_refresh_after_hours": { scopes: ["organization"], schema: z.number().int().min(1).max(24 * 30), default: 24, assumption: "A-OFF-01", group: "Offline", label: "Offline data shows as outdated after (hours)" },
  "offline.clock_skew_flag_minutes": { scopes: ["organization"], schema: z.number().int().min(1).max(24 * 60), default: 10, assumption: "A-OFF-05", group: "Offline", label: "Flag device clock difference above (minutes)" },
  "offline.workflows": {
    scopes: ["organization", "site"],
    schema: z.array(z.enum(["movement_request", "dispensing", "process_steps", "stock_count", "receiving", "pick_pack"])).max(6),
    default: ["movement_request", "dispensing", "stock_count"] as string[],
    assumption: "A-OFF-03, A-OFF-04, A-W4D-01",
    group: "Offline",
    label: "Workflows allowed offline at the site",
    description: "A registered device runs a workflow offline only when it is listed here and granted to the device. Process steps, receiving and pick/pack are not built for offline use yet.",
    requiresApproval: true,
  },
  "offline.anonymous_movement_requests": { scopes: ["organization", "site"], schema: z.boolean(), default: true, assumption: "A-OFF-03", group: "Offline", label: "Unregistered browsers may queue stock moves offline" },
  "offline.allow_self_resolve_discard": { scopes: ["organization"], schema: z.boolean(), default: false, assumption: "A-DM-11", group: "Offline", label: "People may discard their own sync conflicts", requiresApproval: true },
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
