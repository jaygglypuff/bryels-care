import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, inventoryLots, labelJobs, labelTemplates, suppliers } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { getReceipt, lotsToPutAway, placeHold, putAwayLot, putAwayOptions } from "@/modules/inventory";
import { createLabelJobsForLots } from "@/modules/documents";
import { receiveAndPost } from "@/modules/inventory/receiving";
import { decideLot } from "@/modules/quality/dispositions";
import { keywordMatches } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, expectDomain, future, loadSites, loc, mat, onHand } from "../../support/w1b";

/**
 * "To put away" (consultant review flow A): released lots still in quarantine/hold/receiving at the
 * current site, oldest release first, each with the suggested shelf and a friendly quantity.
 */
let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let wh: AuthContext;
let whRvs: AuthContext;
let qa: AuthContext;
let lagunaId: string;

async function receiveLot(locCode: string, qtyG: string, supplierLot: string) {
  const r = await receiveAndPost(wh, {
    idempotencyKey: randomUUID(),
    supplierId: lagunaId,
    supplierDocumentNumber: `DR-${supplierLot}`,
    lines: [{ materialId: (await mat("MAT-0012")).id, qty: qtyG, uom: "g", supplierLotNumber: supplierLot, expiresOn: future(300), locationId: (await loc(nfd.id, locCode)).id }],
  });
  const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
  const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
  return lot;
}

beforeAll(async () => {
  await resetTestDatabase();
  ({ orgId, nfd, rvs } = await loadSites());
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor(orgId, "warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  lagunaId = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
});

describe("lotsToPutAway", () => {
  it("lists a lot only once QA released it, oldest release first, with the suggested shelf and kg", async () => {
    const before = await lotsToPutAway(wh);
    const a = await receiveLot("QUA-01", "60000", "SUPLOT-AAA-771");
    const b = await receiveLot("RCV", "2500", "SUPLOT-BBB-772");
    // Quarantined lots are not on the list: the warehouse waits for QA.
    expect((await lotsToPutAway(wh)).map((t) => t.lotId)).not.toContain(a.id);

    await decideLot(qa, { lotId: b.id, decision: "release", reason: "CoA reviewed, conforms" });
    await decideLot(qa, { lotId: a.id, decision: "release", reason: "CoA reviewed, conforms" });
    const list = (await lotsToPutAway(wh)).filter((t) => !before.some((x) => x.lotId === t.lotId));
    expect(list.map((t) => t.lotNumber)).toEqual([b.lotNumber, a.lotNumber]); // b released first
    const ta = list.find((t) => t.lotId === a.id)!;
    expect(ta).toMatchObject({ fromCode: "QUA-01", itemKind: "material", baseUom: "g", qtyText: "60 kg", supplierLotNumber: "SUPLOT-AAA-771", section: "raw_materials" });
    expect(ta.suggested?.code).toBe("A-01"); // first active storage bin of Raw materials
    expect(list.find((t) => t.lotId === b.id)).toMatchObject({ fromCode: "RCV", qtyText: "2.5 kg" });

    // Tapping the card opens the put-away with the suggested shelf allowed.
    const opts = await putAwayOptions(wh, a.id);
    expect(opts.destinations.map((d) => d.code)).toContain("A-01");
    expect(opts.balances[0]).toMatchObject({ code: "QUA-01", qtyText: "60 kg", looseQtyText: "60 kg" });

    // Put away 10 kg typed in kg: 10,000 g move; the rest stays on the list.
    await putAwayLot(wh, { lotRef: a.lotNumber, locationRef: "A-01", qty: "10", qtyUom: "kg", idempotencyKey: randomUUID() });
    expect(await onHand(a.id, (await loc(nfd.id, "A-01")).id)).toBe("10000.000000");
    expect((await lotsToPutAway(wh)).find((t) => t.lotId === a.id)?.qtyText).toBe("50 kg");
    // A unit that does not fit the lot is refused; more than there is too.
    await expectDomain(putAwayLot(wh, { lotRef: a.lotNumber, locationRef: "A-01", qty: "5", qtyUom: "pcs", idempotencyKey: randomUUID() }), "validation");
    await expectDomain(putAwayLot(wh, { lotRef: a.lotNumber, locationRef: "A-01", qty: "51", qtyUom: "kg", idempotencyKey: randomUUID() }), "insufficient_stock");
    // The rest: gone from the list.
    await putAwayLot(wh, { lotRef: a.lotNumber, locationRef: "A-01", idempotencyKey: randomUUID() });
    expect((await lotsToPutAway(wh)).map((t) => t.lotId)).not.toContain(a.id);
  });

  it("finds a lot by its last digits or the supplier's lot number (choices)", async () => {
    const c = await receiveLot("QUA-01", "1000", "SUPLOT-CCC-990");
    const tail = c.lotNumber.slice(-4);
    expect((await keywordMatches(wh, tail)).some((m) => m.href.endsWith(c.id))).toBe(true);
    expect((await keywordMatches(wh, "CCC-990")).some((m) => m.href.endsWith(c.id))).toBe(true);
  });

  it("leaves out stock in a location under an open QA hold", async () => {
    const d = await receiveLot("HLD-01", "1500", "SUPLOT-DDD-123");
    await decideLot(qa, { lotId: d.id, decision: "release", reason: "CoA reviewed, conforms" });
    expect((await lotsToPutAway(wh)).map((t) => t.lotId)).toContain(d.id);
    await placeHold(qa, { scope: "location", locationId: (await loc(nfd.id, "HLD-01")).id, reasonCode: "suspected_contamination", reason: "Water leak above the cage", idempotencyKey: randomUUID() });
    expect((await lotsToPutAway(wh)).map((t) => t.lotId)).not.toContain(d.id);
  });

  it("is site-scoped: another site's warehouse never sees these lots and cannot put them away; no lot view = forbidden", async () => {
    const e = await receiveLot("QUA-01", "3000", "SUPLOT-EEE-555");
    await decideLot(qa, { lotId: e.id, decision: "release", reason: "CoA reviewed, conforms" });
    expect((await lotsToPutAway(wh)).map((t) => t.lotId)).toContain(e.id);
    expect((await lotsToPutAway(whRvs)).map((t) => t.lotId)).not.toContain(e.id);
    await expectDomain(putAwayLot(whRvs, { lotRef: e.lotNumber, locationRef: "FG-01", idempotencyKey: randomUUID() }), "not_found");
    const noView = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ["inventory.movement.post"], [nfd]);
    await expectDomain(lotsToPutAway(noView), "forbidden");
  });
});

describe("receipt labels: one per container (consultant review flow A)", () => {
  it("getReceipt carries the container count; per-lot copies override the default", async () => {
    const r = await receiveAndPost(wh, {
      idempotencyKey: randomUUID(),
      supplierId: lagunaId,
      supplierDocumentNumber: "DR-LBL-1",
      lines: [{ materialId: (await mat("MAT-0012")).id, qty: "75000", uom: "g", supplierLotNumber: "SUPLOT-LBL-1", expiresOn: future(300), containerCount: 3, locationId: (await loc(nfd.id, "QUA-01")).id }],
    });
    const gr = await getReceipt(wh, r.receiptId);
    expect(gr.lines[0].containerCount).toBe(3);
    const [t] = await db.select().from(labelTemplates).where(eq(labelTemplates.code, "LT-RM-100X50"));
    const out = await createLabelJobsForLots(wh, gr.lines.map((l) => ({ lotId: l.lotId, copies: l.containerCount })), t.id, 1, `gr:${gr.id}:${t.id}`, null);
    expect(out[0].error).toBeUndefined();
    const [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, out[0].jobId!));
    expect(j.copies).toBe(3);
    // Another site's warehouse cannot open the receipt to print its labels.
    await expectDomain(getReceipt(whRvs, r.receiptId), "not_found");
  });
});
