/**
 * ADR-132 §12 (browser walk of the purchase order wizard): the wizard promised "The request's approval covers this
 * order" from the amount alone, and the saved order then went for approval again because an order that big needs more
 * OKs than the request had (`requestApprovalCover` → "approval_steps"). `requestCoverHint` gives the wizard the same
 * answer the save gives. Read only; site and permission checked.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPurchaseOrder, createPurchaseRequest, decidePurchaseRequest, getPurchaseRequest, requestCoverHint, submitPurchaseOrder, submitPurchaseRequest } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { registerAppHooks } from "@/modules/wiring";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { materialByCode, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  u = await w4aUsers(kit);
}, 180_000);

async function approvedRequest(qty: string, price: string) {
  const m = await materialByCode("MAT-0012");
  const pr = await createPurchaseRequest(u.proc, { lines: [{ materialId: m.id, qty, uom: "kg", estimatedUnitAmount: price }] });
  await submitPurchaseRequest(u.proc, { requestId: pr.requestId });
  for (let i = 0; i < 3; i++) {
    const r = await decidePurchaseRequest(i === 0 ? u.manager : u.owner, { requestId: pr.requestId, decision: "approve" }).catch(() => null);
    if (!r || r.final) break;
  }
  return { pr, m, line: (await getPurchaseRequest(u.proc, pr.requestId)).lines[0] };
}

describe("requestCoverHint", () => {
  for (const [qty, price] of [["10", "100"], ["900", "185"]] as const) {
    it(`says what the save does (${qty} kg × ₱${price})`, async () => {
      const { pr, m, line } = await approvedRequest(qty, price);
      const amount = (Number(qty) * Number(price)).toFixed(2);
      const hint = (await requestCoverHint(u.proc, pr.requestId, amount))!;
      expect(hint).toBeTruthy();
      const s = await supplierByName("Laguna Oleo Supply");
      const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty, uom: "kg", unitAmount: price, purchaseRequestLineId: line.id }] });
      const sub = await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
      if (hint.requestSteps >= hint.orderSteps) expect(sub.status).toBe("approved");
      else expect(sub).toMatchObject({ status: "submitted", notCoveredBecause: "approval_steps" });
    });
  }

  it("refuses people who may not make purchase orders and stays inside the caller's sites", async () => {
    const { pr } = await approvedRequest("5", "100");
    await expectCode(requestCoverHint(u.warehouse, pr.requestId, "500.00"), "forbidden");
    const procRvs = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]);
    expect(await requestCoverHint(procRvs, pr.requestId, "500.00")).toBeNull();
    expect(await requestCoverHint(u.proc, "not-a-uuid", "500.00")).toBeNull();
  });
});
