import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { createSupplier, exportSuppliersCsv, getSupplier, listSuppliers, updateSupplier } from "@/modules/masterdata";
import { neutralizeCell, toCsv } from "@/modules/masterdata/csv";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, expectDomain, loadSites } from "../../support/w1b";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let procurement: AuthContext;
let qa: AuthContext;
let wh: AuthContext;
let whRvs: AuthContext;
let auditor: AuthContext;

const base = { code: "SUP-T01", name: "Tagaytay Test Oils (fictional)", qualityStatus: "new" as const, contactName: "Ana Test", email: "Orders@Tagaytay.TEST", paymentTermsDays: "30", defaultLeadTimeDays: 7 };

beforeAll(async () => {
  await resetTestDatabase();
  ({ orgId, nfd, rvs } = await loadSites());
  procurement = await ctxFor(orgId, "procurement@bryels-care.test", ROLE_BUNDLES.procurement.permissions, [nfd, rvs]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor(orgId, "warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  auditor = await ctxFor(orgId, "auditor@bryels-care.test", ROLE_BUNDLES.auditor.permissions, [nfd, rvs]);
});

describe("suppliers (US-2-06)", () => {
  it("procurement creates a supplier; normalised fields; audit masterdata.supplier.created", async () => {
    const s = await createSupplier(procurement, base);
    expect(s).toMatchObject({ code: "SUP-T01", email: "orders@tagaytay.test", paymentTermsDays: 30, defaultLeadTimeDays: 7, qualityStatus: "new", isActive: true });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, s.id), eq(auditEvents.action, "masterdata.supplier.created")));
    expect(ev).toHaveLength(1);
    await expectDomain(createSupplier(procurement, { ...base, name: "Other name" }), "conflict");
    await expectDomain(createSupplier(procurement, { ...base, code: "SUP-T02", name: "tagaytay test oils (FICTIONAL)" }), "conflict");
    await expectDomain(createSupplier(procurement, { ...base, code: "bad code!" }), "validation");
    await expectDomain(createSupplier(procurement, { ...base, code: "SUP-T03", name: "X Y", email: "not-an-email" }), "validation");
    // Unknown fields are refused (.strict()).
    await expectDomain(createSupplier(procurement, { ...base, code: "SUP-T04", name: "Strict Co", taxIdentifier: "123" } as never), "validation");
  });

  it("suspending needs a reason; QA may edit; the change is audited with before and after", async () => {
    const [s] = await listSuppliers(procurement, { q: "SUP-T01" });
    await expectDomain(updateSupplier(qa, s.id, { ...base, qualityStatus: "suspended" }), "validation");
    await updateSupplier(qa, s.id, { ...base, qualityStatus: "suspended", qualityStatusReason: "CoA values did not match retained sample" });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, s.id), eq(auditEvents.action, "masterdata.supplier.updated")));
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toMatchObject({ qualityStatus: "new" });
    expect(ev[0].after).toMatchObject({ qualityStatus: "suspended" });
    const detail = await getSupplier(wh, s.id);
    expect(detail.qualityStatus).toBe("suspended");
  });

  it("authz.role_escalation: warehouse and auditor can view but not create, edit or (warehouse) export", async () => {
    const [s] = await listSuppliers(wh, { q: "SUP-T01" });
    expect(s).toBeTruthy();
    await expectDomain(createSupplier(wh, { ...base, code: "SUP-T09", name: "Nope Co" }), "forbidden");
    await expectDomain(updateSupplier(wh, s.id, base), "forbidden");
    await expectDomain(createSupplier(auditor, { ...base, code: "SUP-T09", name: "Nope Co" }), "forbidden");
    await expectDomain(exportSuppliersCsv(wh), "forbidden");
    await expectDomain(getSupplier(wh, "00000000-0000-0000-0000-000000000000"), "not_found");
  });

  it("export writes platform.export.created and neutralises formula cells", async () => {
    await createSupplier(procurement, { ...base, code: "SUP-T05", name: "=HYPERLINK(evil)" });
    const out = await exportSuppliersCsv(auditor);
    expect(out.csv).toContain(`"'=HYPERLINK(evil)"`);
    expect(out.csv.split("\r\n")[0]).toBe(`"Code","Name","Contact","Phone","Email","City","Payment terms (days)","Lead time (days)","Quality status","Active"`);
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.action, "platform.export.created"));
    expect(ev.some((e) => (e.after as { kind?: string })?.kind === "suppliers" && e.actorId === auditor.userId)).toBe(true);
  });

  it("receipt counts only come from the viewer's sites (authz.cross_site.query)", async () => {
    const nfdView = (await listSuppliers(wh, { q: "Laguna Oleo" }))[0];
    const rvsView = (await listSuppliers(whRvs, { q: "Laguna Oleo" }))[0];
    expect(nfdView.receipts).toBeGreaterThan(0);
    expect(rvsView.receipts).toBe(0);
  });

  it("csv helpers: every risky prefix is neutralised (export.formula_neutralized)", () => {
    for (const p of ["=", "+", "-", "@", "\t", "\r"]) expect(neutralizeCell(`${p}1`)).toBe(`'${p}1`);
    expect(neutralizeCell("a|b%")).toBe("a|b%");
    expect(toCsv(["a"], [['say "hi"']])).toBe(`"a"\r\n"say ""hi"""\r\n`);
  });
});
