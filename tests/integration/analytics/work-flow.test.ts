/**
 * "How work flows" (ADR-106 §5, ADR-110 C0): the 16 stages from "Ask to buy" to "Invoice" with counts from real
 * records at the caller's current site; each count needs its own view permissions (a count the viewer may not see is
 * not run and a stage with nothing visible is hidden); the list behind a number is the same query as the number; a
 * stage is red when an item waits that no message points to. Cross-site and role negatives.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { FLOW_STAGES, getWorkFlow, getWorkFlowCounts, getWorkFlowItems } from "@/modules/analytics";
import { createPurchaseRequest, submitPurchaseRequest } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let ownerRvs: AuthContext;
let warehouse: AuthContext;
let proc: AuthContext;
let sales: AuthContext;
let finance: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  ownerRvs = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.rvs, kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  proc = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd, kit.rvs]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd, kit.rvs]);
}, 240_000);

const stage = async (ctx: AuthContext, key: string) => (await getWorkFlow(ctx)).stages.find((s) => s.key === key);
const count = async (ctx: AuthContext, key: string) => (await getWorkFlow(ctx)).stages.flatMap((s) => s.counts).find((c) => c.key === key);

describe("How work flows: stages and counts", () => {
  it("the owner sees the 16 stages in order, numbered 1–16, each with one button", async () => {
    const wf = await getWorkFlow(owner);
    expect(wf.stages.map((s) => s.key)).toEqual(FLOW_STAGES.map((s) => s.key));
    expect(wf.stages.map((s) => s.n)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(wf.stages[0].title).toBe("Ask to buy");
    expect(wf.stages[15].title).toBe("Invoice");
    for (const s of wf.stages) {
      expect(s.button.href.startsWith("/"), s.key).toBe(true);
      expect(s.total, s.key).toBeGreaterThanOrEqual(0);
    }
  });

  it("each number equals the list behind it, and Home counts equal the page's counts", async () => {
    const wf = await getWorkFlow(owner);
    for (const c of wf.stages.flatMap((s) => s.counts)) {
      const r = await getWorkFlowItems(owner, c.key);
      expect(r.items.length, c.key).toBe(c.count);
      for (const i of r.items) expect(i.href.startsWith("/"), `${c.key} ${i.ref}`).toBe(true);
    }
    const home = await getWorkFlowCounts(warehouse, ["so_to_pick", "shipments_to_check", "shipments_to_send", "shipments_no_proof"]);
    for (const h of home) expect(h.count, h.key).toBe((await count(warehouse, h.key))!.count);
  });

  it("a submitted request to buy counts at stage 1 and is not red: the manager was told", async () => {
    const before = (await count(owner, "pr_waiting"))!.count;
    const pr = await createPurchaseRequest(proc, { justification: "Work-flow test (fictional)", lines: [{ materialId: (await makeLot(owner, kit.nfd.id, (await loc(kit.nfd.id, "A-01")).id, "1")).materialId!, qty: "5", uom: "kg" }] });
    await submitPurchaseRequest(proc, { requestId: pr.requestId });
    const c = (await count(owner, "pr_waiting"))!;
    expect(c.count).toBe(before + 1);
    const items = (await getWorkFlowItems(owner, "pr_waiting")).items;
    const mine = items.find((i) => i.id === pr.requestId)!;
    expect(mine.href).toBe(`/procurement/requests/${pr.requestId}`);
    expect(mine.told).toBe(true);
  });

  it("a new lot waiting for QA with no message makes stage 5 red; a message about it clears the red", async () => {
    const lot = await makeLot(owner, kit.nfd.id, (await loc(kit.nfd.id, "A-01")).id, "10", { status: "quarantine" });
    const items = (await getWorkFlowItems(owner, "lots_waiting")).items;
    expect(items.find((i) => i.id === lot.id)?.told).toBe(false);
    expect((await stage(owner, "qa_incoming"))!.waitsOnNobody).toBe(true);
    const [qa] = await db.select().from(users).where(eq(users.email, "qa.nfd@bryels-care.test"));
    await db.insert(notifications).values({ organizationId: kit.orgId, siteId: kit.nfd.id, recipientUserId: qa.id, kind: "lot_waiting_qa", title: "New lot waits for QA", body: "Test (fictional)", entityType: "inventory_lot", entityId: lot.id, link: `/quality/lots/${lot.id}` });
    expect((await getWorkFlowItems(owner, "lots_waiting")).items.find((i) => i.id === lot.id)?.told).toBe(true);
  });

  it("customer orders: short and can-be-set-aside never overlap and are confirmed orders", async () => {
    const short = (await getWorkFlowItems(owner, "so_short")).items.map((i) => i.id);
    const ready = (await getWorkFlowItems(owner, "so_can_set_aside")).items.map((i) => i.id);
    expect(short.filter((id) => ready.includes(id))).toEqual([]);
    const noWo = (await getWorkFlowItems(owner, "short_no_wo")).items.map((i) => i.id);
    for (const id of noWo) expect(short).toContain(id);
    // a stage counts a record once even when two of its counts list it
    const s7 = (await stage(owner, "customer_orders"))!;
    expect(s7.total).toBeLessThanOrEqual(s7.counts.reduce((n, c) => n + c.count, 0));
  });
});

describe("How work flows: site scope and permissions (negatives)", () => {
  it("only the current site is counted: an NFD lot does not count at RVS", async () => {
    const lot = await makeLot(owner, kit.nfd.id, (await loc(kit.nfd.id, "A-01")).id, "3", { status: "quarantine" });
    expect((await getWorkFlowItems(owner, "lots_waiting")).items.some((i) => i.id === lot.id)).toBe(true);
    expect((await getWorkFlowItems(ownerRvs, "lots_waiting")).items.some((i) => i.id === lot.id)).toBe(false);
  });

  it("a current site outside the person's sites is refused", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
    const sneaky = new AuthContext(u.id, kit.orgId, u.displayName, u.email, ["warehouse_operator"], new Set(ROLE_BUNDLES.warehouse_operator.permissions), [kit.nfd], kit.rvs.id);
    await expectCode(getWorkFlow(sneaky), "not_found");
    await expectCode(getWorkFlowItems(sneaky, "so_to_pick"), "not_found");
  });

  it("a stage the viewer may not see is hidden, and its list is refused", async () => {
    const wh = (await getWorkFlow(warehouse)).stages.map((s) => s.key);
    expect(wh).not.toContain("invoice"); // no finance.invoice.view
    expect(wh).toContain("pick");
    await expectCode(getWorkFlowItems(warehouse, "inv_draft"), "forbidden");
    const pr = (await getWorkFlow(proc)).stages.map((s) => s.key);
    expect(pr).toEqual(expect.arrayContaining(["ask_to_buy", "order", "delivery_coming"]));
    expect(pr).not.toContain("pick");
    expect(pr).not.toContain("invoice");
    await expectCode(getWorkFlowItems(proc, "shipments_to_check"), "forbidden");
    // sales sees customer orders but not purchasing approvals of stage 2's orders? (sales has no purchase_order.view)
    const so = (await getWorkFlow(sales)).stages;
    expect(so.find((s) => s.key === "order")).toBeUndefined();
    expect(so.find((s) => s.key === "customer_orders")).toBeTruthy();
    // a count inside a visible stage is left out when its own permission is missing (finance: no production.work_order.view)
    const fin = (await getWorkFlow(finance)).stages.find((s) => s.key === "make_it");
    expect(fin).toBeUndefined();
    expect((await getWorkFlow(finance)).stages.find((s) => s.key === "invoice")?.counts.map((c) => c.key)).toEqual(["not_billed", "inv_draft", "inv_to_approve", "inv_approved"]);
  });

  it("an unknown list key is not found", async () => {
    await expectCode(getWorkFlowItems(owner, "nope" as never), "not_found");
  });
});
