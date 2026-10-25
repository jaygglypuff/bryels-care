import type { AuthContext, SiteRef } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";

/**
 * Report registry contract (US-5-04, docs/reports-and-templates.md §9 "Configurable reports",
 * docs/analytics-kpis.md §5). A report is code: parameters, a scoped query, columns and footnotes.
 * The organization switches a report on/off and adds an owner note (report_definitions).
 */

export const REPORT_CATEGORIES = ["Inventory", "Production", "Quality", "Sales", "Procurement", "Audit and access"] as const; // Procurement: Wave 4 W4A
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportValue = string | number | null;
export type ReportRow = Record<string, ReportValue>;

export type ReportColumn = {
  key: string;
  header: string;
  /** Plain decimal string or number; exported as a number. */
  numeric?: boolean;
  /** Column holding the unit of a numeric column (quantities are never summed across units). */
  unitKey?: string;
  /** Omitted (masked) unless the viewer holds this permission (docs/permissions-matrix.md §6). */
  requires?: Permission;
  personalData?: boolean;
};

export const PERIOD_PRESETS = ["today", "yesterday", "last_7_days", "last_30_days", "this_week", "previous_week", "this_month", "previous_month", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_week: "This week (Mon–Sun)",
  previous_week: "Previous week (Mon–Sun)",
  this_month: "This month",
  previous_month: "Previous month",
  custom: "Custom dates",
};

export type ParamField =
  | { name: "period"; kind: "period"; label: string; default: PeriodPreset }
  | { name: string; kind: "select"; label: string; options: { value: string; label: string }[]; default: string }
  | { name: string; kind: "text"; label: string; maxLength: number; placeholder?: string }
  | { name: string; kind: "number"; label: string; min: number; max: number; default: number };

/** A resolved half-open local-date period [from, toExclusive) in the organization's time zone. */
export type ResolvedPeriod = { preset: PeriodPreset; from: string; toExclusive: string; label: string };

export type ReportQuery = {
  ctx: AuthContext;
  /** Validated parameter values (strings for select/text, numbers for number fields). */
  params: Record<string, string | number>;
  period: ResolvedPeriod | null;
  /** Sites in scope: requested ∩ allowed ∩ where the viewer holds the view permission. Never empty. */
  siteIds: string[];
  sites: SiteRef[];
  /** Fetch at most this many rows. */
  limit: number;
  tz: string;
  /** Local business date of the organization (no CURRENT_DATE in SQL, analytics-kpis §1.6). */
  today: string;
  now: Date;
  /** True when the viewer holds an organization-wide assignment (organization-level audit rows). */
  orgWide: boolean;
};

export type ReportDefinition = {
  /** RPT-<AREA>-<NAME> (docs/analytics-kpis.md §5.1). */
  code: string;
  title: string;
  category: ReportCategory;
  description: string;
  /** Module view permission for the rows (checked at each site in scope, besides analytics.report.view). */
  viewPermission: Permission;
  /** Module export permission for files, when the module has one (besides analytics.report.export). */
  exportPermission: Permission | null;
  /** Only organization-wide roles (owner, auditor) may run it. */
  orgWideOnly?: boolean;
  /** S = sensitive (default), R would need re-authentication (none yet). */
  sensitivity: "N" | "S";
  params: ParamField[];
  columns: ReportColumn[];
  fetch: (q: ReportQuery) => Promise<ReportRow[]>;
  /** Value label of every figure (docs/analytics-kpis.md §1.2). */
  valueLabel: "Actual" | "Estimate";
  /** Time basis and definitions, printed as footnotes (FR-analytics-05). */
  timeBasis: string;
  sources: string;
  footnotes: string[];
  /** Totals printed under the table (computed from the rows; units are never mixed). */
  summarize?: (rows: ReportRow[]) => [string, string][];
  /** May be scheduled (US-5-05). */
  schedulable: boolean;
  defaultCadence?: string;
  /** Link for a row on screen (drill-down), never printed. */
  rowLink?: (row: ReportRow) => string | null;
};
