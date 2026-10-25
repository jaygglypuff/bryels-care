/**
 * Shipped retention defaults (docs/data-model.md §12.2) without runtime dependencies, so the demo seed
 * and scripts can read them. Engineering placeholders awaiting the qualified reviewers' confirmation;
 * NOT legal advice (docs/security.md §7, A-SEC-24).
 */
import type { RETENTION_ACTIONS, RETENTION_BASES, RETENTION_DATA_CLASSES } from "../../db/schema/retention";

export type RetentionDataClass = (typeof RETENTION_DATA_CLASSES)[number];
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export type RetentionBasis = (typeof RETENTION_BASES)[number];

export type PolicyDefault = {
  dataClass: RetentionDataClass;
  target: string;
  retentionMonths: number | null;
  retentionDays: number | null;
  basis: RetentionBasis;
  minimumMonths: number | null;
  action: RetentionAction;
  assumptionId: string;
  description: string;
};

const d = (dataClass: RetentionDataClass, target: string, period: { months?: number; days?: number } | null, basis: RetentionBasis, action: RetentionAction, assumptionId: string, description: string, minimumMonths: number | null = null): PolicyDefault => ({
  dataClass,
  target,
  retentionMonths: period?.months ?? null,
  retentionDays: period?.days ?? null,
  basis,
  minimumMonths,
  action,
  assumptionId,
  description,
});

/** Shipped defaults: docs/data-model.md §12.2, one row per class/target. Placeholders for reviewer confirmation. */
export const RETENTION_DEFAULTS: readonly PolicyDefault[] = [
  d("quality_batch", "*", { months: 60 }, "expiry_date", "archive", "A-SEC-25", "Batches, BMR, dispensing, tests, dispositions, deviations: 5 years after lot expiry, minimum 7 years", 84),
  d("stock_ledger", "*", { months: 84 }, "record_date", "archive", "A-SEC-25", "Stock movements, lots, containers, counts, receipts (immutable)"),
  d("financial", "*", { months: 120 }, "period_end", "archive", "A-SEC-26", "Invoices, bills, payments, costing (immutable)"),
  d("sales_customer", "*", { months: 84 }, "last_activity", "anonymise", "A-SEC-24", "Customer contact persons are blanked; documents are kept"),
  d("procurement", "*", { months: 84 }, "last_activity", "anonymise", "A-SEC-24", "Supplier contact persons are blanked; documents are kept"),
  d("employee_personal", "*", { months: 60 }, "employment_end", "anonymise", "A-SEC-27", "Employee personal fields after employment + 5 years"),
  d("attendance", "*", { months: 36 }, "record_date", "delete", "A-SEC-28", "Original time-clock files; summaries are kept"),
  d("payroll", "*", { months: 120 }, "period_end", "archive", "A-SEC-29", "Payroll periods, lines and payslips (immutable once closed)"),
  d("audit", "*", null, "record_date", "keep", "A-DM-14", "Audit events: kept indefinitely; partitions archived, never dropped without owner approval", 84),
  d("identity", "users", { months: 24 }, "last_activity", "anonymise", "A-DM-16", "Users anonymised 2 years after deactivation; the row stays for references"),
  d("security", "sessions", { days: 30 }, "record_date", "delete", "A-SEC-11", "Sessions 30 days after expiry or revocation"),
  d("security", "password_reset_tokens", { days: 7 }, "record_date", "delete", "A-SEC-11", "Reset tokens 7 days after expiry or use"),
  d("idempotency", "idempotency_keys", { days: 7 }, "record_date", "delete", "A-SEC-21", "Idempotency keys of completed commands"),
  d("sync", "*", { days: 180 }, "record_date", "delete", "A-DM-12", "Offline sync commands and conflicts after a terminal status (Phase 7)"),
  d("jobs_notifications", "background_jobs", { days: 90 }, "record_date", "delete", "A-DM-18", "Succeeded or cancelled background jobs (failed jobs are kept until retried or cancelled)"),
  d("jobs_notifications", "notifications", { days: 180 }, "record_date", "delete", "A-DM-18", "In-app notifications (unacknowledged critical ones are kept)"),
  d("documents_generated", "*", null, "parent_record", "keep", "A-SEC-24", "Generated documents follow their parent record"),
  d("labels_generated", "*", { days: 90 }, "record_date", "delete", "A-RPT-20", "Label files (rows follow the labelled lot or box)"),
  d("exports", "*", { days: 30 }, "record_date", "delete", "A-SEC-30", "Export files and scheduled report outputs"),
  d("attachments_other", "*", null, "parent_record", "keep", "A-SEC-24", "Photos, scans and certificates follow their parent record"),
  d("backups", "*", { days: 35 }, "record_date", "delete", "A-SEC-31", "Daily dumps 35 days + 12 monthly (pruned by the backup script; held runs never)"),
  d("portal", "*", { months: 24 }, "last_activity", "delete", "A-SEC-24", "Portal users after account lifetime + 2 years (Phase 8)"),
  d("master_data", "*", null, "record_date", "keep", "A-DM-19", "Master data and retired versions are kept"),
  d("master_data_shadow", "*", { months: 36 }, "record_date", "delete", "A-DM-20", "Setting change requests, import mapping versions, non-attendance import rows"),
  d("platform_ops", "metrics_samples", { days: 90 }, "record_date", "delete", "A-DM-33", "Metrics samples"),
  d("platform_ops", "worker_heartbeats", { days: 7 }, "record_date", "delete", "A-DM-33", "Worker heartbeats of stopped workers"),
  d("platform_ops", "*", { months: 24 }, "record_date", "archive", "A-DM-33", "Reconciliation runs, backup runs, restore drills and purge runs (Gate 9 evidence)"),
];

/**
 * Classes whose rows are immutable business records (ADR-006, brief: never edit historical
 * balances): no configuration can make the sweep delete or anonymise them.
 */
export const PROTECTED_CLASSES: readonly RetentionDataClass[] = ["quality_batch", "stock_ledger", "financial", "payroll", "audit", "master_data", "documents_generated"];
export const policyKey = (p: { dataClass: string; target: string }) => `${p.dataClass}/${p.target}`;

export function periodLabel(p: { retentionMonths: number | null; retentionDays: number | null; action: string; minimumMonths?: number | null }): string {
  if (p.action === "keep" && !p.retentionMonths && !p.retentionDays) return p.minimumMonths ? `indefinite (minimum ${p.minimumMonths} months)` : "indefinite";
  const base = p.retentionMonths ? `${p.retentionMonths} months` : `${p.retentionDays} days`;
  return p.minimumMonths ? `${base}, minimum ${p.minimumMonths} months` : base;
}

