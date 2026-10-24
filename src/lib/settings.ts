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
