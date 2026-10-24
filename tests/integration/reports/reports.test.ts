/**
 * US-5-04 report registry and outputs (docs/reports-and-templates.md §9 "Configurable reports",
 * docs/analytics-kpis.md §5): every output carries title, filters, generated at/by, freshness,
 * footnotes, value label, row count and truncation notice (A-RPT-18); exports go through the shared
 * export layer and are audited; negative tests for cross-site access and role escalation; report admin.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, inventoryLots, settings } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { REPORTS, exportReport, listReportLibrary, printReport, runReport, updateReportDefinition } from "@/modules/reports";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let admin: AuthContext;
let manager: AuthContext;
let whNfd: AuthContext;
let whRvs: AuthContext;
let operator: AuthContext;
let sales: AuthContext;
let auditor: AuthContext;
let qa: AuthContext;

const csvText = (b: Buffer) => b.toString("utf8").replace(/^﻿/, "");

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  whNfd = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
});

describe("report library (US-5-04)", () => {
  it("lists only reports whose rows the caller may view; the access report only for organization-wide roles", async () => {
    const codes = async (c: AuthContext) => (await listReportLibrary(c)).map((e) => e.def.code);
    const wh = await codes(whNfd);
    expect(wh).toEqual(expect.arrayContaining(["RPT-INV-STOCK", "RPT-INV-EXPIRY", "RPT-INV-MOVEMENTS", "RPT-INV-RECEIPTS"]));
    expect(await codes(sales)).not.toContain("RPT-QUA-DEVIATIONS");
    expect(wh).not.toContain("RPT-AUD-EXTRACT");
    expect(await codes(owner)).toContain("RPT-SEC-ACCESS");
    expect(await codes(auditor)).toContain("RPT-SEC-ACCESS");
    expect(await codes(manager)).not.toContain("RPT-SEC-ACCESS");
    // every registered report has a code, footnotes, a time basis and at least one column
    for (const r of REPORTS) {
      expect(r.code).toMatch(/^RPT-[A-Z]+-[A-Z-]+$/);
      expect(r.columns.length).toBeGreaterThan(0);
      expect(r.timeBasis.length).toBeGreaterThan(10);
    }
  });

  it("a user without analytics.report.view sees nothing", async () => {
    const noReports = await asUser(kit, "warehouse.nfd@bryels-care.test", ["warehouse_operator"], [kit.nfd]);
    const stripped = new AuthContext(
      noReports.userId,
      noReports.organizationId,
      noReports.displayName,
      noReports.email,
      noReports.roleCodes,
      new Set([...noReports.permissions].filter((p) => p !== "analytics.report.view")),
      noReports.allowedSites,
      noReports.currentSiteId,
    );
    await expectCode(listReportLibrary(stripped), "forbidden");
    await expectCode(runReport(stripped, "RPT-INV-STOCK", {}), "forbidden");
  });
});

describe("report output contract", () => {
  it("carries title, filters, generated at/by, freshness, value label, footnotes, row count and links", async () => {
    const fg = await loc(kit.nfd.id, "FG-01");
    const lot = await makeLot(whNfd, kit.nfd.id, fg.id, "1250", { expiresOn: null });
    const out = await runReport(whNfd, "RPT-INV-STOCK", { q: lot.lotNumber });
    expect(out.title).toBe("Stock on hand by lot and location");
    expect(out.filters).toEqual(expect.arrayContaining([["Sites", "NFD"], ["Item or lot contains", lot.lotNumber]]));
    expect(out.generatedBy).toContain("warehouse.nfd@bryels-care.test");
    expect(out.generatedAtText).toMatch(/\(Asia\/Manila\)$/);
    expect(out.freshness).toMatch(/^Live: read from posted records at/);
    expect(out.valueLabel).toBe("Actual");
    expect(out.footnotes.some((f) => f.startsWith("Time basis:"))).toBe(true);
    expect(out.footnotes.some((f) => f.startsWith("Sources:"))).toBe(true);
    expect(out.rowCount).toBe(1);
    expect(out.rows[0]).toMatchObject({ lot: lot.lotNumber, site: "NFD", location: "FG-01", qty: "1250", unit: "g" });
    expect(out.truncated).toBe(false);
    expect(out.links[0]).toBe(`/inventory/${lot.id}`);
    expect(out.summary.find(([k]) => k.startsWith("Total on hand"))?.[1]).toBe("1250 g");
  });

  it("validates filters: unknown keys, bad choices and custom dates are field errors", async () => {
    const e1 = await expectCode(runReport(whNfd, "RPT-INV-STOCK", { nope: "1" }), "validation");
    expect(e1.details?.fieldErrors).toHaveProperty("nope");
    const e2 = await expectCode(runReport(whNfd, "RPT-INV-MOVEMENTS", { period: "custom", from: "2026-10-10" }), "validation");
    expect(e2.details?.fieldErrors).toHaveProperty("to");
    const e3 = await expectCode(runReport(whNfd, "RPT-INV-STOCK", { status: "lost" }), "validation");
    expect(e3.details?.fieldErrors).toHaveProperty("status");
    await expectCode(runReport(whNfd, "RPT-NOPE", {}), "not_found");
  });

  it("movements over a custom period are half-open in the organization's time zone", async () => {
    const fg = await loc(kit.nfd.id, "FG-01");
    const lot = await makeLot(whNfd, kit.nfd.id, fg.id, "40");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const hit = await runReport(whNfd, "RPT-INV-MOVEMENTS", { period: "custom", from: today, to: today, q: lot.lotNumber });
    expect(hit.rows.map((r) => r.lot)).toEqual([lot.lotNumber]);
    expect(hit.filters.find(([k]) => k === "Period")?.[1]).toContain(today);
    const miss = await runReport(whNfd, "RPT-INV-MOVEMENTS", { period: "custom", from: "2020-01-01", to: "2020-01-31", q: lot.lotNumber });
    expect(miss.rows).toHaveLength(0);
  });
});

describe("authorization (negative tests)", () => {
  it("authz.cross_site.report: a Site A user asking for Site B gets not_found; all-sites never includes Site B rows", async () => {
    const fg = await loc(kit.rvs.id, "FG-01");
    const rvsLot = await makeLot(whRvs, kit.rvs.id, fg.id, "99");
    await expectCode(runReport(whNfd, "RPT-INV-STOCK", { site: kit.rvs.id }), "not_found");
    await expectCode(exportReport(manager, "RPT-INV-STOCK", { site: kit.rvs.id }, "csv"), "not_found");
    await expectCode(exportReport(whNfd, "RPT-INV-STOCK", {}, "csv"), "forbidden"); // warehouse: report view only (matrix §3.11)
    const all = await runReport(whNfd, "RPT-INV-STOCK", {});
    expect(all.rows.some((r) => r.lot === rvsLot.lotNumber)).toBe(false);
    expect(all.sites.map((s) => s.code)).toEqual(["NFD"]);
    const both = await runReport(qa, "RPT-INV-STOCK", { q: rvsLot.lotNumber });
    expect(both.rows.map((r) => r.site)).toEqual(["RVS"]);
  });

  it("role escalation: report view does not grant the module rows, exports or the owner-only report", async () => {
    await expectCode(runReport(sales, "RPT-QUA-DEVIATIONS", {}), "forbidden");
    await expectCode(runReport(whNfd, "RPT-AUD-EXTRACT", {}), "forbidden");
    await expectCode(exportReport(operator, "RPT-INV-STOCK", {}, "csv"), "forbidden"); // no analytics.report.export
    await expectCode(exportReport(sales, "RPT-INV-STOCK", {}, "csv"), "forbidden"); // no inventory.balance.export
    await expectCode(runReport(manager, "RPT-SEC-ACCESS", {}), "forbidden"); // organization-wide roles only
    await expectCode(printReport(operator, "RPT-INV-STOCK", {}), "forbidden");
  });

  it("authz.sensitive_fields.masked: deviation text needs quality.test_result.view; the column is omitted and named", async () => {
    const forOperator = await runReport(operator, "RPT-QUA-DEVIATIONS", {});
    expect(forOperator.columns.map((c) => c.key)).not.toContain("description");
    expect(forOperator.maskedColumns).toEqual(["Description"]);
    expect(forOperator.footnotes.some((f) => f.includes("Columns omitted"))).toBe(true);
    expect(forOperator.rows.length).toBeGreaterThan(0);
    const forQa = await runReport(qa, "RPT-QUA-DEVIATIONS", {});
    expect(forQa.columns.map((c) => c.key)).toContain("description");
  });
});

describe("exports through the shared export layer", () => {
  it("CSV carries the report header block, is audited twice (platform.export.created, analytics.report.exported)", async () => {
    const file = await exportReport(manager, "RPT-INV-STOCK", {}, "csv");
    const text = csvText(file.body);
    expect(text).toContain('"Report","RPT-INV-STOCK · Stock on hand by lot and location"');
    expect(text).toContain('"Data freshness","Live: read from posted records at');
    expect(text).toContain('"Value label","Actual (computed from posted records)"');
    expect(text).toMatch(/"Footnote 1","Definition: /);
    expect(text).toContain('"Site filter","NFD"');
    expect(file.truncated).toBe(false);
    const evs = await db.select().from(auditEvents).where(and(eq(auditEvents.actorId, manager.userId), eq(auditEvents.entityNumber, "RPT-INV-STOCK")));
    expect(evs.map((e) => e.action)).toContain("analytics.report.exported");
    const [exp] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.export.created"), eq(auditEvents.entityNumber, "analytics.report.RPT-INV-STOCK")));
    expect(exp.after).toMatchObject({ format: "csv", siteScope: [kit.nfd.id], rowCount: file.rowCount, sha256: file.sha256 });
  });

  it("A-RPT-18: above the row cap the file is truncated with a notice instead of failing", async () => {
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "platform.export.max_rows", value: 2 });
    try {
      const csv = await exportReport(manager, "RPT-INV-STOCK", {}, "csv");
      expect(csv.truncated).toBe(true);
      expect(csv.rowCount).toBe(2);
      expect(csvText(csv.body)).toContain('"Truncated","yes: only the first 2 rows are included');
      const html = await exportReport(manager, "RPT-INV-STOCK", {}, "html");
      expect(html.truncated).toBe(true);
      expect(html.body.toString("utf8")).toContain("Truncated: only the first 2 rows are included");
    } finally {
      await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "platform.export.max_rows")));
    }
  });

  it("printable HTML escapes data and carries every header element; no script", async () => {
    const fg = await loc(kit.nfd.id, "FG-01");
    const lot = await makeLot(whNfd, kit.nfd.id, fg.id, "5");
    await db.update(inventoryLots).set({ lotNumber: `${lot.lotNumber}<script>x</script>` }).where(eq(inventoryLots.id, lot.id));
    const file = await exportReport(manager, "RPT-INV-STOCK", { q: lot.lotNumber }, "html");
    const html = file.body.toString("utf8");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    for (const s of ["Generated at", "Generated by", "Data freshness", "Value label", "Rows", "Footnotes", "Sites"]) expect(html).toContain(s);
  });
});

describe("report administration (analytics.report.admin)", () => {
  it("a switched-off report cannot be run; only administrators change it; the change is audited", async () => {
    await expectCode(updateReportDefinition(manager, "RPT-QUA-HOLDS", { enabled: false, ownerNote: null, reason: "not used" }), "forbidden");
    await expectCode(updateReportDefinition(owner, "RPT-QUA-HOLDS", { enabled: false, ownerNote: null, reason: "not used" }), "forbidden");
    await expectCode(updateReportDefinition(admin, "RPT-QUA-HOLDS", { enabled: false, ownerNote: null, reason: "" }), "validation");
    await updateReportDefinition(admin, "RPT-QUA-HOLDS", { enabled: false, ownerNote: null, reason: "Holds are reviewed on the QA board" });
    await expectCode(runReport(qa, "RPT-QUA-HOLDS", {}), "state");
    expect((await listReportLibrary(qa)).map((e) => e.def.code)).not.toContain("RPT-QUA-HOLDS");
    expect((await listReportLibrary(admin)).find((e) => e.def.code === "RPT-QUA-HOLDS")?.enabled).toBe(false);
    await updateReportDefinition(admin, "RPT-QUA-HOLDS", { enabled: true, ownerNote: "Definition reviewed by the QA lead (demo)", reason: "Back in use" });
    const out = await runReport(qa, "RPT-QUA-HOLDS", {});
    expect(out.footnotes).toContain("Owner note: Definition reviewed by the QA lead (demo)");
    const evs = await db.select().from(auditEvents).where(eq(auditEvents.action, "analytics.report_definition.changed"));
    expect(evs).toHaveLength(2);
    expect(evs[1].before).toMatchObject({ enabled: false, version: 1 });
  });
});

describe("US-5-14 weekly access-and-exceptions report", () => {
  it("lists role grants, restricted-permission use, controlled exceptions, reprints by kind and exports for the owner", async () => {
    const day = "2026-10-14";
    const at = new Date(`${day}T03:00:00Z`);
    const ev = async (action: `${string}.${string}.${string}`, extra: { after?: unknown; reason?: string; entityNumber?: string } = {}) => {
      const id = await audit(db, admin, { action, entityType: "test", entityNumber: extra.entityNumber ?? "X-1", siteId: kit.nfd.id, after: extra.after, reason: extra.reason ?? null });
      await db.update(auditEvents).set({ occurredAt: at }).where(eq(auditEvents.id, id!));
    };
    await ev("identity.site_assignment.granted", { reason: "new planner" });
    await ev("quality.disposition.approved", { entityNumber: "L-1" });
    await ev("inventory.stock_movement.held_stock_issued", { reason: "sampling" });
    await ev("documents.generated_document.reprinted", { after: { kind: "bmr" }, reason: "lost_copy" });
    await ev("documents.label_job.reprinted", { after: { reprintNo: 1 } });
    await ev("platform.export.created", { after: { code: "inventory.availability", format: "csv", rowCount: 12 } });
    await ev("inventory.stock_movement.posted"); // not part of the report
    const out = await runReport(owner, "RPT-SEC-ACCESS", { period: "custom", from: "2026-10-12", to: "2026-10-18" });
    const sections = out.rows.map((r) => r.section);
    expect(sections).toEqual([
      "1 Role grants and access changes",
      "2 Restricted-permission use",
      "3 Controlled exceptions",
      "4 Reprints",
      "4 Reprints",
      "5 Sensitive exports",
    ]);
    expect(out.rows.find((r) => r.section === "5 Sensitive exports")?.detail).toBe("inventory.availability · csv · 12 rows");
    expect(out.summary.find(([k]) => k === "Reprints by kind")?.[1]).toBe("bmr: 1 · label: 1");
    // auditors may run it too; the site manager may not (organization-wide only)
    expect((await runReport(auditor, "RPT-SEC-ACCESS", { period: "custom", from: "2026-10-12", to: "2026-10-18" })).rowCount).toBe(6);
  });

  it("the audit extract shows organization-level events only to organization-wide viewers", async () => {
    const id = await audit(db, admin, { action: "platform.setting.changed", entityType: "setting", entityNumber: "W3B-ORG-EVENT", siteId: null });
    expect(id).toBeTruthy();
    const forOwner = await runReport(owner, "RPT-AUD-EXTRACT", { q: "W3B-ORG-EVENT" });
    expect(forOwner.rows.map((r) => r.site)).toEqual(["Organization"]);
    const forManager = await runReport(manager, "RPT-AUD-EXTRACT", { q: "W3B-ORG-EVENT" });
    expect(forManager.rows).toHaveLength(0);
    // exporting the audit log needs platform.audit.export (owner, auditor), not just view
    await expectCode(exportReport(manager, "RPT-AUD-EXTRACT", {}, "csv"), "forbidden");
    expect((await exportReport(auditor, "RPT-AUD-EXTRACT", { q: "W3B-ORG-EVENT" }, "xlsx")).rowCount).toBe(1);
  });
});
