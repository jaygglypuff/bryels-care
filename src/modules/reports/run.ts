import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, reportDefinitions, userSiteAssignments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type ExportDefinition, runExport } from "@/lib/export";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { renderReportHtml } from "./html";
import { type ParsedParams, describeFilters, localDate, parseParams } from "./params";
import { REPORTS, reportByCode } from "./registry";
import type { ReportColumn, ReportDefinition, ReportRow } from "./types";

/**
 * Running and exporting reports (US-5-04). Every output carries title, filters as entered, site
 * scope, generated at/by, data freshness, value label, footnotes (definition, time basis, sources),
 * row count and a truncation notice (A-RPT-18). Rows come from the report's scoped query with the
 * caller's AuthContext; columns needing a permission the caller lacks are omitted (masked).
 */

export type ReportFormat = "csv" | "xlsx" | "html";
export const REPORT_FORMATS: ReportFormat[] = ["csv", "xlsx", "html"];

export type ReportOutput = {
  code: string;
  title: string;
  category: string;
  description: string;
  organizationName: string;
  generatedAt: Date;
  generatedAtText: string;
  generatedBy: string;
  sites: SiteRef[];
  siteLabel: string;
  filters: [string, string][];
  /** Storable, canonical parameters (schedule, links). */
  params: Record<string, string>;
  freshness: string;
  valueLabel: "Actual" | "Estimate";
  footnotes: string[];
  columns: ReportColumn[];
  maskedColumns: string[];
  rows: ReportRow[];
  rowCount: number;
  truncated: boolean;
  /** The cap that applied (screen rows or export rows). */
  cap: number;
  summary: [string, string][];
  personalData: boolean;
  /** Drill-down links per row on screen (never printed). */
  links: (string | null)[];
};

const stamp = (d: Date, tz: string) => d.toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }) + ` (${tz})`;

async function orgInfo(organizationId: string) {
  const [o] = await db.select({ name: organizations.name, tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return { name: o?.name ?? "", tz: o?.tz ?? "Asia/Manila" };
}

/** Organization-wide assignment (owner, auditor, system admin), read from the assignments. */
export async function hasOrgWideAssignment(ctx: AuthContext): Promise<boolean> {
  if (ctx.options.access) return ctx.isOrganizationWide;
  const [r] = await db
    .select({ id: userSiteAssignments.id })
    .from(userSiteAssignments)
    .where(and(eq(userSiteAssignments.userId, ctx.userId), eq(userSiteAssignments.isOrganizationWide, true), activeAssignment()))
    .limit(1);
  return !!r;
}

export async function reportOverride(organizationId: string, code: string) {
  const [r] = await db.select().from(reportDefinitions).where(and(eq(reportDefinitions.organizationId, organizationId), eq(reportDefinitions.reportCode, code))).limit(1);
  return r ?? null;
}

/** The report, or not_found; refuses a report the administrator switched off. */
export async function loadReport(ctx: AuthContext, code: string): Promise<{ def: ReportDefinition; ownerNote: string | null }> {
  const def = reportByCode(code);
  if (!def) throw new DomainError("not_found", "There is no report with this code.");
  const o = await reportOverride(ctx.organizationId, code);
  if (o && !o.isEnabled) throw new DomainError("state", "This report is switched off for your organization. An administrator can switch it on in the report library.");
  return { def, ownerNote: o?.ownerNote ?? null };
}

/**
 * Sites the caller may run the report for, holding every permission in `perms` AT the site
 * (per-assignment precision, W2E). A requested site outside scope is "not found"; a site in scope
 * without the permission is "forbidden".
 */
export function reportScope(ctx: AuthContext, perms: Permission[], siteId: string | null): SiteRef[] {
  if (siteId) {
    ctx.requireSite(siteId);
    for (const p of perms) if (!ctx.canAt(p, siteId)) throw new DomainError("forbidden", `You do not have permission for this report at this site (${p}).`);
    return ctx.allowedSites.filter((s) => s.id === siteId);
  }
  const sites = ctx.allowedSites.filter((s) => perms.every((p) => ctx.canAt(p, s.id)));
  if (sites.length === 0) throw new DomainError("forbidden", `You do not have permission for this report at any of your sites (${perms.join(", ")}).`);
  return sites;
}

/** Can the caller see this report in the library at all (no data access)? */
export function canSeeReport(ctx: AuthContext, def: ReportDefinition): boolean {
  if (!ctx.can("analytics.report.view") || !ctx.can(def.viewPermission)) return false;
  return ctx.allowedSites.some((s) => ctx.canAt(def.viewPermission, s.id));
}

type Prepared = {
  def: ReportDefinition;
  parsed: ParsedParams;
  sites: SiteRef[];
  tz: string;
  today: string;
  orgName: string;
  orgWide: boolean;
  ownerNote: string | null;
  visible: ReportColumn[];
  masked: string[];
};

async function prepare(ctx: AuthContext, code: string, raw: Record<string, unknown>, now: Date, forExport: boolean): Promise<Prepared> {
  ctx.require("analytics.report.view");
  if (forExport) ctx.require("analytics.report.export");
  const { def, ownerNote } = await loadReport(ctx, code);
  ctx.require(def.viewPermission);
  if (forExport && def.exportPermission) ctx.require(def.exportPermission);
  const orgWide = await hasOrgWideAssignment(ctx);
  if (def.orgWideOnly && !orgWide) throw new DomainError("forbidden", "This report is for organization-wide roles (owner, auditor) only.");
  const org = await orgInfo(ctx.organizationId);
  const today = localDate(now, org.tz);
  const parsed = parseParams(def, raw, today);
  const perms: Permission[] = [def.viewPermission, ...(forExport && def.exportPermission ? [def.exportPermission] : [])];
  const sites = reportScope(ctx, perms, parsed.siteId);
  const visible = def.columns.filter((c) => !c.requires || sites.every((s) => ctx.canAt(c.requires!, s.id)));
  const masked = def.columns.filter((c) => !visible.includes(c)).map((c) => c.header);
  return { def, parsed, sites, tz: org.tz, today, orgName: org.name, orgWide, ownerNote, visible, masked };
}

function footnotesFor(p: Prepared): string[] {
  const out = [`Definition: ${p.def.description}`, `Time basis: ${p.def.timeBasis}`, `Sources: ${p.def.sources}.`, ...p.def.footnotes];
  if (p.masked.length) out.push(`Columns omitted because your role does not include them: ${p.masked.join(", ")}.`);
  if (p.ownerNote) out.push(`Owner note: ${p.ownerNote}`);
  return out;
}

async function fetchRows(ctx: AuthContext, p: Prepared, limit: number, now: Date) {
  return p.def.fetch({ ctx, params: p.parsed.values, period: p.parsed.period, siteIds: p.sites.map((s) => s.id), sites: p.sites, limit, tz: p.tz, today: p.today, now, orgWide: p.orgWide });
}

function output(ctx: AuthContext, p: Prepared, rows: ReportRow[], cap: number, now: Date, generatedBy?: string): ReportOutput {
  const truncated = rows.length > cap;
  const shown = truncated ? rows.slice(0, cap) : rows;
  const siteLabel = p.sites.map((s) => s.code).join(", ");
  return {
    code: p.def.code,
    title: p.def.title,
    category: p.def.category,
    description: p.def.description,
    organizationName: p.orgName,
    generatedAt: now,
    generatedAtText: stamp(now, p.tz),
    generatedBy: generatedBy ?? `${ctx.displayName} <${ctx.email}>`,
    sites: p.sites,
    siteLabel,
    filters: describeFilters(p.def, p.parsed, siteLabel),
    params: p.parsed.canonical,
    freshness: `Live: read from posted records at ${stamp(now, p.tz)}.`,
    valueLabel: p.def.valueLabel,
    footnotes: footnotesFor(p),
    columns: p.visible,
    maskedColumns: p.masked,
    rows: shown,
    rowCount: shown.length,
    truncated,
    cap,
    summary: p.def.summarize ? p.def.summarize(shown) : [],
    personalData: p.visible.some((c) => c.personalData),
    links: shown.map((r) => (p.def.rowLink ? p.def.rowLink(r) : null)),
  };
}

/** On-screen run: at most `reports.screen_rows` rows (the export holds up to the export cap). */
export async function runReport(ctx: AuthContext, code: string, raw: Record<string, unknown>, opts: { now?: Date } = {}): Promise<ReportOutput> {
  const now = opts.now ?? new Date();
  const p = await prepare(ctx, code, raw, now, false);
  const cap = await getSetting(db, ctx.organizationId, "reports.screen_rows");
  const rows = await fetchRows(ctx, p, cap + 1, now);
  return output(ctx, p, rows, cap, now);
}

export type ReportFile = { fileName: string; contentType: string; body: Buffer; rowCount: number; sha256: string; truncated: boolean; siteIds: string[]; maskedColumns: string[] };

const cellValue = (v: unknown) => (v === null || v === undefined ? null : typeof v === "number" ? String(v) : String(v));

/**
 * File output (CSV, XLSX through src/lib/export.ts; printable HTML here). Needs analytics.report.export
 * plus the module export permission when the module has one; caps at platform.export.max_rows with a
 * truncation notice. Audits platform.export.created (with filters, scope, rows, format, hash) and
 * analytics.report.exported.
 */
export async function exportReport(
  ctx: AuthContext,
  code: string,
  raw: Record<string, unknown>,
  format: ReportFormat,
  opts: { now?: Date; generatedBy?: string } = {},
): Promise<ReportFile> {
  if (!REPORT_FORMATS.includes(format)) throw new DomainError("validation", "Choose CSV, XLSX or printable HTML.", { field: "format" });
  const now = opts.now ?? new Date();
  const p = await prepare(ctx, code, raw, now, true);
  const siteIds = p.sites.map((s) => s.id);
  const maxRows = await getSetting(db, ctx.organizationId, "platform.export.max_rows");
  let file: ReportFile;
  if (format === "html") {
    const rows = await fetchRows(ctx, p, maxRows + 1, now);
    const out = output(ctx, p, rows, maxRows, now, opts.generatedBy);
    const body = Buffer.from(renderReportHtml(out), "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const fileName = `${p.def.code.toLowerCase()}-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}.html`;
    await audit(db, ctx, {
      action: "platform.export.created",
      entityType: "export",
      entityNumber: `analytics.report.${p.def.code}`,
      siteId: siteIds.length === 1 ? siteIds[0] : null,
      after: { code: `analytics.report.${p.def.code}`, format, filters: p.parsed.canonical, siteScope: siteIds, rowCount: out.rowCount, sha256, maskedColumns: p.masked, fileName, ...(out.truncated ? { truncated: true } : {}) },
    });
    file = { fileName, contentType: "text/html; charset=utf-8", body, rowCount: out.rowCount, sha256, truncated: out.truncated, siteIds, maskedColumns: p.masked };
  } else {
    const def: ExportDefinition<Record<string, unknown>, ReportRow> = {
      code: `analytics.report.${p.def.code}`,
      title: p.def.title,
      permission: "analytics.report.export",
      sensitivity: "N",
      columns: p.visible.map((c) => ({ header: c.header, value: (r: ReportRow) => cellValue(r[c.key]), numeric: c.numeric, personalData: c.personalData })),
      fetch: (_c, _f, limit) => fetchRows(ctx, p, limit, now),
      siteScope: () => siteIds,
      fileName: () => p.def.code.toLowerCase(),
    };
    const extras: [string, string][] = [
      ["Report", `${p.def.code} · ${p.def.title}`],
      ...p.parsed.period ? ([["Period", p.parsed.period.label]] as [string, string][]) : [],
      ["Data freshness", `Live: read from posted records at ${stamp(now, p.tz)}`],
      ["Value label", `${p.def.valueLabel} (computed from posted records)`],
      ...footnotesFor(p).map((f, i) => [`Footnote ${i + 1}`, f] as [string, string]),
    ];
    const f = await runExport(ctx, def, p.parsed.canonical, format, { overflow: "truncate", headerExtras: extras, generatedBy: opts.generatedBy });
    file = { fileName: f.fileName, contentType: f.contentType, body: f.body, rowCount: f.rowCount, sha256: f.sha256, truncated: f.truncated, siteIds, maskedColumns: p.masked };
  }
  await audit(db, ctx, {
    action: "analytics.report.exported",
    entityType: "report",
    entityNumber: p.def.code,
    siteId: siteIds.length === 1 ? siteIds[0] : null,
    after: { code: p.def.code, format, params: p.parsed.canonical, siteScope: siteIds, rowCount: file.rowCount, truncated: file.truncated, sha256: file.sha256 },
  });
  return file;
}

/** The printable HTML page (ADR-026: browser print / "Save as PDF"); an export, so it has the export checks and audit. */
export async function printReport(ctx: AuthContext, code: string, raw: Record<string, unknown>, opts: { now?: Date } = {}): Promise<ReportOutput> {
  const now = opts.now ?? new Date();
  const p = await prepare(ctx, code, raw, now, true);
  const maxRows = await getSetting(db, ctx.organizationId, "platform.export.max_rows");
  const rows = await fetchRows(ctx, p, maxRows + 1, now);
  const out = output(ctx, p, rows, maxRows, now);
  const siteIds = p.sites.map((s) => s.id);
  await audit(db, ctx, {
    action: "analytics.report.printed",
    entityType: "report",
    entityNumber: p.def.code,
    siteId: siteIds.length === 1 ? siteIds[0] : null,
    after: { code: p.def.code, params: p.parsed.canonical, siteScope: siteIds, rowCount: out.rowCount, truncated: out.truncated },
  });
  return out;
}

export type LibraryEntry = { def: ReportDefinition; enabled: boolean; ownerNote: string | null; canExport: boolean; canSchedule: boolean };

/** The report library: every report the caller may run (administrators also see switched-off ones). */
export async function listReportLibrary(ctx: AuthContext): Promise<LibraryEntry[]> {
  ctx.require("analytics.report.view");
  const overrides = await db.select().from(reportDefinitions).where(eq(reportDefinitions.organizationId, ctx.organizationId));
  const orgWide = await hasOrgWideAssignment(ctx);
  const admin = ctx.can("analytics.report.admin");
  const out: LibraryEntry[] = [];
  for (const def of REPORTS) {
    if (!canSeeReport(ctx, def) && !admin) continue;
    if (def.orgWideOnly && !orgWide && !admin) continue;
    const o = overrides.find((x) => x.reportCode === def.code);
    const enabled = o ? o.isEnabled : true;
    if (!enabled && !admin) continue;
    out.push({
      def,
      enabled,
      ownerNote: o?.ownerNote ?? null,
      canExport: ctx.can("analytics.report.export") && (!def.exportPermission || ctx.can(def.exportPermission)),
      canSchedule: def.schedulable && ctx.can("analytics.scheduled_report.create"),
    });
  }
  return out;
}

/** analytics.report.admin: switch a report on/off and set the owner note (audited analytics.report_definition.changed). */
export async function updateReportDefinition(ctx: AuthContext, code: string, input: { enabled: boolean; ownerNote: string | null; reason: string }) {
  ctx.require("analytics.report.admin");
  if (!reportByCode(code)) throw new DomainError("not_found", "There is no report with this code.");
  const note = input.ownerNote?.trim() || null;
  if (note && note.length > 500) throw new DomainError("validation", "Keep the owner note under 500 characters.", { field: "ownerNote" });
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("validation", "Give a reason of at least 3 characters.", { field: "reason" });
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(reportDefinitions).where(and(eq(reportDefinitions.organizationId, ctx.organizationId), eq(reportDefinitions.reportCode, code))).for("update").limit(1);
    const [row] = before
      ? await tx
          .update(reportDefinitions)
          .set({ isEnabled: input.enabled, ownerNote: note, version: before.version + 1, updatedBy: ctx.userId, updatedAt: new Date() })
          .where(eq(reportDefinitions.id, before.id))
          .returning()
      : await tx.insert(reportDefinitions).values({ organizationId: ctx.organizationId, reportCode: code, isEnabled: input.enabled, ownerNote: note, updatedBy: ctx.userId }).returning();
    await audit(tx, ctx, {
      action: "analytics.report_definition.changed",
      entityType: "report_definition",
      entityId: row.id,
      entityNumber: code,
      siteId: null,
      reason,
      before: before ? { enabled: before.isEnabled, ownerNote: before.ownerNote, version: before.version } : null,
      after: { enabled: row.isEnabled, ownerNote: row.ownerNote, version: row.version },
    });
    return row;
  });
}
