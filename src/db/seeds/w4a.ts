/**
 * Wave 4 W4A fictional demo data (procurement; runs inside the ALLOW_DEMO_SEED-guarded seed):
 * - the approved purchase order template PO-STD (documents module, ADR-026);
 * - the approved-supplier list decided by QA for the W1B supplier × material pairs, with fictional
 *   prices, MOQ and lead times; one proposal (Bukidnon Aloe Farms × aloe juice) waiting for QA;
 * - reorder policies at NFD (the nightly job or "Recompute" turns them into suggestions);
 * - purchase requests (one waiting for approval, one approved to convert) and purchase orders in every
 *   state: draft, submitted (two-step above PHP 50,000), approved, sent and late, partially received
 *   (a posted PO receipt with a quarantine lot), received, closed and cancelled;
 * - a rejected lot of Laguna Botanicals in the rejected cage and a supplier return for it waiting for
 *   the site manager's approval;
 * - one forecast override waiting for a second person.
 * Numbers continue the running sequences. Every name and figure is fictional.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";
import { definitionChecksum } from "../../modules/documents/checksum";
import { purchaseOrderRendererV1 } from "../../modules/documents/renderers/purchase-order-v1";

type Db = PostgresJsDatabase<typeof s>;

async function nextNo(db: Db, organizationId: string, type: string, prefix: string, width: number, period: string) {
  const rows = await db.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${type}, ${prefix}, ${width}, ${period}, 2)
    ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  return [prefix, period, String(rows[0].value).padStart(width, "0")].filter(Boolean).join("-");
}

export async function seedW4a(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const YY = String(manila.getFullYear()).slice(2);
  const YYMM = YY + String(manila.getMonth() + 1).padStart(2, "0");
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))))[0];
  const proc = await user("procurement@bryels-care.test");
  const qa = await user("qa.nfd@bryels-care.test");
  const manager = await user("manager.nfd@bryels-care.test");
  const owner = await user("owner@bryels-care.test");
  const admin = await user("admin@bryels-care.test");
  const wh = await user("warehouse.nfd@bryels-care.test");
  const planner = (await user("planner.nfd@bryels-care.test")) ?? manager;
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  if (!proc || !qa || !manager || !owner || !admin || !wh || !nfd) return;
  const loc = async (code: string) => (await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, code))))[0];
  const qua = await loc("QUA-01");
  const rej = await loc("REJ");
  const [whN] = await db.select().from(s.warehouses).where(eq(s.warehouses.siteId, nfd.id)).limit(1);

  // 1. Purchase order template (approved by QA a week ago, like the W3E fulfilment templates).
  const approvedAt = new Date(Date.now() - 7 * 86_400_000);
  const definition = purchaseOrderRendererV1.defaultDefinition("purchase_order");
  const [tpl] = await db
    .insert(s.documentTemplates)
    .values({ organizationId: O, code: "PO-STD", name: "Purchase order (A4, supplier copy)", templateKind: "purchase_order", pageSize: definition.page.size, orientation: definition.page.orientation, createdBy: admin.id, createdAt: approvedAt })
    .returning();
  await db.insert(s.documentTemplateVersions).values({ documentTemplateId: tpl.id, versionNo: 1, status: "approved", definition, definitionChecksum: definitionChecksum(definition), changeNote: "First version (demo)", createdBy: admin.id, createdAt: approvedAt, submittedBy: manager.id, submittedAt: approvedAt, approvedBy: qa.id, approvedAt, effectiveFrom: approvedAt });

  // 2. Approved-supplier list decisions, prices (fictional), MOQ and lead times.
  const pairs = await db
    .select({ sm: s.supplierMaterials, supplier: s.suppliers.name, code: s.materials.code, baseUom: s.materials.baseUom })
    .from(s.supplierMaterials)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.supplierMaterials.supplierId))
    .innerJoin(s.materials, eq(s.materials.id, s.supplierMaterials.materialId))
    .where(eq(s.supplierMaterials.organizationId, O));
  const TERMS: Record<string, { price: string; moq: string; lead: number; part: string }> = {
    "MAT-0012": { price: "185.00", moq: "50", lead: 7, part: "LOS-CO-RBD" },
    "MAT-0013": { price: "160.00", moq: "100", lead: 14, part: "MPC-PO-25" },
    "MAT-0043": { price: "1200.00", moq: "5", lead: 10, part: "LB-ACX-1" },
    "MAT-0044": { price: "1100.00", moq: "5", lead: 10, part: "LB-GLX-1" },
    "MAT-0061": { price: "95.00", moq: "25", lead: 10, part: "CC-GLY-USP" },
    "MAT-0062": { price: "140.00", moq: "25", lead: 10, part: "CC-CA-50" },
    "MAT-0060": { price: "60.00", moq: "20", lead: 12, part: "BAF-AVJ" },
    "PKG-0101": { price: "2.5000", moq: "1000", lead: 5, part: "MPP-W135" },
    "PKG-0102": { price: "18.0000", moq: "200", lead: 5, part: "MPP-C48" },
  };
  const unitOf = (base: string) => (base === "g" ? "kg" : base === "mL" ? "L" : base);
  const pairOf = new Map<string, typeof s.supplierMaterials.$inferSelect>();
  for (const p of pairs) {
    const t = TERMS[p.code];
    const pending = p.supplier === "Bukidnon Aloe Farms";
    await db
      .update(s.supplierMaterials)
      .set({
        isApproved: !pending,
        requestedBy: pending ? null : proc.id,
        requestedAt: pending ? null : at(24 * 30),
        approvedBy: pending ? null : qa.id,
        approvedAt: pending ? null : at(24 * 29),
        auditDate: pending ? null : day(-60),
        supplierPartNumber: t?.part ?? null,
        leadTimeDays: t?.lead ?? null,
        moqQty: t?.moq ?? null,
        moqUom: t ? unitOf(p.baseUom) : null,
        unitPrice: t?.price ?? null,
        priceUom: t ? unitOf(p.baseUom) : null,
        currency: t ? "PHP" : null,
        priceEffectiveFrom: t ? day(-45) : null,
        updatedBy: proc.id,
      })
      .where(eq(s.supplierMaterials.id, p.sm.id));
    await db.insert(s.supplierMaterialChanges).values({
      organizationId: O,
      supplierMaterialId: p.sm.id,
      action: "approve",
      status: pending ? "pending" : "approved",
      proposedBy: proc.id,
      proposedAt: pending ? at(20) : at(24 * 30),
      note: pending ? "New aloe source for the hand lotion; supplier questionnaire and CoA template received (fictional)." : "Existing supplier, CoA and specification on file (fictional demo record).",
      auditDate: pending ? null : day(-60),
      decidedBy: pending ? null : qa.id,
      decidedAt: pending ? null : at(24 * 29),
      decisionNote: pending ? null : "Approved on the evidence on file.",
    });
    pairOf.set(p.code, (await db.select().from(s.supplierMaterials).where(eq(s.supplierMaterials.id, p.sm.id)))[0]);
  }
  const mat = async (code: string) => (await db.select().from(s.materials).where(and(eq(s.materials.organizationId, O), eq(s.materials.code, code))))[0];
  const sup = async (name: string) => (await db.select().from(s.suppliers).where(and(eq(s.suppliers.organizationId, O), eq(s.suppliers.name, name))))[0];

  // 3. Reorder policies (NFD). Wrapper and glycerin minimums sit above the seeded stock, so "Recompute" suggests them.
  const policies: [string, string, string, string | null][] = [
    ["PKG-0101", "20000", "5000", "Manila Print & Pack"],
    ["MAT-0061", "60000", "10000", "Cebu Chemicals"],
    ["MAT-0012", "50000", "10000", "Laguna Oleo Supply"],
  ];
  for (const [code, min, safety, supName] of policies) {
    const m = await mat(code);
    const sp = supName ? await sup(supName) : null;
    if (m) await db.insert(s.materialReorderPolicies).values({ organizationId: O, siteId: nfd.id, materialId: m.id, minStockBase: min, safetyStockBase: safety, preferredSupplierId: sp?.id ?? null, updatedBy: proc.id });
  }

  // 4. Purchase requests.
  const pr = async (status: "submitted" | "approved", requester: typeof wh, line: { code: string; qty: string; uom: string; base: string }, hoursAgo: number) => {
    const m = await mat(line.code);
    const requestNumber = await nextNo(db, O, "PR", "PR", 5, YY);
    const [r] = await db
      .insert(s.purchaseRequests)
      .values({ organizationId: O, siteId: nfd.id, requestNumber, status, requestedBy: requester.id, neededByDate: day(14), justification: "Stock for the next soap campaign (fictional).", submittedBy: requester.id, submittedAt: at(hoursAgo - 1), approvedBy: status === "approved" ? manager.id : null, approvedAt: status === "approved" ? at(hoursAgo - 2) : null, createdBy: requester.id, createdAt: at(hoursAgo), statusChangedAt: at(hoursAgo - 2), statusChangedBy: status === "approved" ? manager.id : requester.id })
      .returning();
    await db.insert(s.purchaseRequestLines).values({ organizationId: O, siteId: nfd.id, purchaseRequestId: r.id, lineNo: 1, materialId: m.id, qtyEntered: line.qty, uomEntered: line.uom, qtyBase: line.base, baseUom: m.baseUom });
    const tr = [
      { fromState: null, toState: "draft", actorId: requester.id, occurredAt: at(hoursAgo) },
      { fromState: "draft", toState: "submitted", actorId: requester.id, occurredAt: at(hoursAgo - 1) },
      ...(status === "approved" ? [{ fromState: "submitted", toState: "approved", actorId: manager.id, occurredAt: at(hoursAgo - 2) }] : []),
    ];
    await db.insert(s.purchaseRequestStateTransitions).values(tr.map((t) => ({ ...t, organizationId: O, siteId: nfd.id, purchaseRequestId: r.id, correlationId: uuidv7() })));
    if (status === "approved") await db.insert(s.approvalDecisions).values({ organizationId: O, siteId: nfd.id, recordType: "purchase_request", recordId: r.id, step: 1, cycle: 1, decision: "approved", decidedBy: manager.id, decidedAt: at(hoursAgo - 2) });
    return r;
  };
  await pr("submitted", wh, { code: "PKG-0101", qty: "10000", uom: "pcs", base: "10000" }, 6);
  await pr("approved", planner, { code: "MAT-0062", qty: "50", uom: "kg", base: "50000" }, 30);

  // 5. Purchase orders in every state.
  type PoSpec = { status: string; supplier: string; lines: { code: string; qtyKg: string; received?: string }[]; daysAgo: number; expectedIn: number; approvers?: { step: number; by: string }[]; urgent?: string; cancelReason?: string };
  const transitionsFor: Record<string, string[]> = {
    draft: ["draft"],
    submitted: ["draft", "submitted"],
    approved: ["draft", "submitted", "approved"],
    sent: ["draft", "submitted", "approved", "sent"],
    partially_received: ["draft", "submitted", "approved", "sent", "partially_received"],
    received: ["draft", "submitted", "approved", "sent", "received"],
    closed: ["draft", "submitted", "approved", "sent", "received", "closed"],
    cancelled: ["draft", "submitted", "approved", "cancelled"],
  };
  const pos: Record<string, { id: string; poNumber: string }> = {};
  const receiveSeeded = async (po: { id: string; poNumber: string }, supplier: typeof s.suppliers.$inferSelect, items: { line: typeof s.purchaseOrderLines.$inferSelect; qtyBase: string; sLot: string }[], hoursAgo: number) => {
    const grNo = await nextNo(db, O, "GR", "GR", 5, YY);
    const [gr] = await db
      .insert(s.goodsReceipts)
      .values({ organizationId: O, siteId: nfd.id, receiptNumber: grNo, receiptKind: "purchase_order", purchaseOrderId: po.id, status: "posted", supplierId: supplier.id, supplierName: supplier.name, supplierDocumentNumber: `${supplier.code}-DR-${3000 + hoursAgo}`, receivedBy: wh.id, receivedAt: at(hoursAgo), postedAt: at(hoursAgo), postedBy: wh.id, createdBy: wh.id, createdAt: at(hoursAgo), correlationId: uuidv7() })
      .returning();
    let n = 0;
    for (const it of items) {
      n += 1;
      const m = (await db.select().from(s.materials).where(eq(s.materials.id, it.line.materialId)))[0];
      const lotNumber = await nextNo(db, O, "LOT", "L", 5, YYMM);
      const [lot] = await db.insert(s.inventoryLots).values({ organizationId: O, siteId: nfd.id, lotNumber, itemKind: "material", materialId: m.id, supplierName: supplier.name, supplierLotNumber: it.sLot, manufacturedOn: day(-40), expiresOn: day(m.shelfLifeDays ?? 365), qualityStatus: "quarantine", baseUom: m.baseUom, createdBy: wh.id, createdAt: at(hoursAgo) }).returning();
      const [mv] = await db.insert(s.stockMovements).values({ organizationId: O, siteId: nfd.id, movementType: "receipt", lotId: lot.id, toLocationId: qua.id, qtyBase: it.qtyBase, baseUom: m.baseUom, sourceDocumentType: "goods_receipt", sourceDocumentId: gr.id, sourceDocumentNumber: grNo, postedBy: wh.id, postedAt: at(hoursAgo), idempotencyKey: `gr:${gr.id}:${n}` }).returning();
      await db.insert(s.inventoryBalances).values({ siteId: nfd.id, lotId: lot.id, locationId: qua.id, qtyBase: it.qtyBase });
      await db.insert(s.goodsReceiptLines).values({ goodsReceiptId: gr.id, lineNo: n, lotId: lot.id, materialId: m.id, qtyEntered: String(Number(it.qtyBase) / (m.baseUom === "g" ? 1000 : 1)), uomEntered: unitOf(m.baseUom), qtyBase: it.qtyBase, locationId: qua.id, supplierLotNumber: it.sLot, manufacturedOn: day(-40), expiresOn: day(m.shelfLifeDays ?? 365), containerCount: 2, storageConditionsConfirmed: true, initialQualityStatus: "quarantine", stockMovementId: mv.id, purchaseOrderLineId: it.line.id, createdBy: wh.id, createdAt: at(hoursAgo) });
    }
    return gr;
  };
  const specs: [string, PoSpec][] = [
    ["draft", { status: "draft", supplier: "Cebu Chemicals", lines: [{ code: "MAT-0061", qtyKg: "50" }], daysAgo: 0, expectedIn: 10 }],
    ["submitted", { status: "submitted", supplier: "Mindanao Palm Co.", lines: [{ code: "MAT-0013", qtyKg: "500" }], daysAgo: 1, expectedIn: 14 }],
    ["approved", { status: "approved", supplier: "Laguna Botanicals", lines: [{ code: "MAT-0043", qtyKg: "10" }], daysAgo: 2, expectedIn: 8, approvers: [{ step: 1, by: "manager" }] }],
    ["sent", { status: "sent", supplier: "Manila Print & Pack", lines: [{ code: "PKG-0102", qtyKg: "400" }], daysAgo: 9, expectedIn: -3, approvers: [{ step: 1, by: "manager" }] }],
    ["partially_received", { status: "partially_received", supplier: "Laguna Oleo Supply", lines: [{ code: "MAT-0012", qtyKg: "300", received: "120" }], daysAgo: 8, expectedIn: 2, approvers: [{ step: 1, by: "manager" }, { step: 2, by: "owner" }] }],
    ["received", { status: "received", supplier: "Cebu Chemicals", lines: [{ code: "MAT-0062", qtyKg: "25", received: "25" }], daysAgo: 15, expectedIn: -4, approvers: [{ step: 1, by: "manager" }] }],
    ["closed", { status: "closed", supplier: "Manila Print & Pack", lines: [{ code: "PKG-0101", qtyKg: "2000", received: "2000" }], daysAgo: 25, expectedIn: -18, approvers: [{ step: 1, by: "manager" }] }],
    ["cancelled", { status: "cancelled", supplier: "Cebu Chemicals", lines: [{ code: "MAT-0061", qtyKg: "25" }], daysAgo: 20, expectedIn: -8, approvers: [{ step: 1, by: "manager" }], cancelReason: "Ordered twice by mistake; replaced by a later order (fictional)." }],
  ];
  const actor = (k: string) => (k === "owner" ? owner : manager);
  for (const [key, sp] of specs) {
    const supplier = await sup(sp.supplier);
    const poNumber = await nextNo(db, O, "PO", "PO", 5, YY);
    const created = at(sp.daysAgo * 24 + 6);
    const lineRows: { m: typeof s.materials.$inferSelect; qtyEntered: string; uom: string; qtyBase: string; unit: string; amount: string; received: string }[] = [];
    for (const l of sp.lines) {
      const m = await mat(l.code);
      const pair = pairOf.get(l.code)!;
      const factor = m.baseUom === "g" ? 1000 : 1;
      const unit = pair.unitPrice ?? "0";
      lineRows.push({ m, qtyEntered: l.qtyKg, uom: unitOf(m.baseUom), qtyBase: String(Number(l.qtyKg) * factor), unit, amount: (Number(l.qtyKg) * Number(unit)).toFixed(4), received: String(Number(l.received ?? 0) * factor) });
    }
    const subtotal = lineRows.reduce((a, l) => a + Number(l.amount), 0).toFixed(4);
    const sentStates = ["sent", "partially_received", "received", "closed"];
    const [po] = await db
      .insert(s.purchaseOrders)
      .values({
        organizationId: O,
        siteId: nfd.id,
        poNumber,
        status: sp.status,
        supplierId: supplier.id,
        shipToWarehouseId: whN?.id ?? null,
        orderDate: day(-sp.daysAgo),
        expectedDate: day(sp.expectedIn),
        paymentTermsDays: supplier.paymentTermsDays,
        subtotalAmount: subtotal,
        taxAmount: "0",
        totalAmount: subtotal,
        notes: "Deliver to the receiving dock, 07:00–15:00 (fictional).",
        submittedBy: sp.status === "draft" ? null : proc.id,
        submittedAt: sp.status === "draft" ? null : at(sp.daysAgo * 24 + 5),
        approvedBy: sp.approvers ? actor(sp.approvers.at(-1)!.by).id : null,
        approvedAt: sp.approvers ? at(sp.daysAgo * 24 + 4) : null,
        sentAt: sentStates.includes(sp.status) ? at(sp.daysAgo * 24 + 3) : null,
        sentBy: sentStates.includes(sp.status) ? proc.id : null,
        sentTo: sentStates.includes(sp.status) ? supplier.email : null,
        sendResult: sentStates.includes(sp.status) ? "download" : null,
        supplierReference: sentStates.includes(sp.status) ? `${supplier.code}-SO-${100 + sp.daysAgo}` : null,
        closedAt: sp.status === "closed" ? at(24 * 10) : null,
        closedBy: sp.status === "closed" ? proc.id : null,
        closeReason: sp.status === "closed" ? "All received." : null,
        cancelReason: sp.cancelReason ?? null,
        createdBy: proc.id,
        createdAt: created,
        statusChangedAt: at(sp.daysAgo * 24),
        statusChangedBy: proc.id,
      })
      .returning();
    pos[key] = po;
    const lines = [];
    for (const [i, l] of lineRows.entries()) {
      const received = Number(l.received);
      const [row] = await db
        .insert(s.purchaseOrderLines)
        .values({ organizationId: O, siteId: nfd.id, purchaseOrderId: po.id, lineNo: i + 1, materialId: l.m.id, supplierMaterialId: pairOf.get(l.m.code)!.id, qtyEntered: l.qtyEntered, uomEntered: l.uom, qtyBase: l.qtyBase, baseUom: l.m.baseUom, unitAmount: l.unit, lineAmount: l.amount, expectedDate: day(sp.expectedIn), qtyReceivedBase: "0", lineStatus: sp.status === "cancelled" ? "cancelled" : received >= Number(l.qtyBase) ? "received" : "open" })
        .returning();
      lines.push({ row, received });
    }
    const states = transitionsFor[sp.status];
    await db.insert(s.purchaseOrderStateTransitions).values(
      states.map((to, i) => ({ organizationId: O, siteId: nfd.id, purchaseOrderId: po.id, fromState: i === 0 ? null : states[i - 1], toState: to, actorId: to === "approved" ? actor(sp.approvers?.at(-1)?.by ?? "manager").id : proc.id, reason: to === "cancelled" ? sp.cancelReason! : to === "closed" ? "All received." : null, occurredAt: at(sp.daysAgo * 24 + 6 - i), correlationId: uuidv7() })),
    );
    for (const a of sp.approvers ?? []) await db.insert(s.approvalDecisions).values({ organizationId: O, siteId: nfd.id, recordType: "purchase_order", recordId: po.id, step: a.step, cycle: 1, decision: "approved", decidedBy: actor(a.by).id, decidedAt: at(sp.daysAgo * 24 + 4 + (a.step === 1 ? 1 : 0)) });
    const toReceive = lines.filter((l) => l.received > 0);
    if (toReceive.length) {
      await receiveSeeded(po, supplier, toReceive.map((l) => ({ line: l.row, qtyBase: String(l.received), sLot: `${supplier.code.slice(-4)}-${2500 + sp.daysAgo}` })), sp.daysAgo * 24 - 30 > 0 ? sp.daysAgo * 24 - 30 : 20);
      for (const l of toReceive) await db.update(s.purchaseOrderLines).set({ qtyReceivedBase: String(l.received) }).where(eq(s.purchaseOrderLines.id, l.row.id));
    }
  }

  // 6. A rejected lot of Laguna Botanicals (guava leaf extract, CoA out of specification) and a supplier return waiting for approval.
  const lb = await sup("Laguna Botanicals");
  const glx = await mat("MAT-0044");
  if (lb && glx && rej) {
    const grNo = await nextNo(db, O, "GR", "GR", 5, YY);
    const [gr] = await db.insert(s.goodsReceipts).values({ organizationId: O, siteId: nfd.id, receiptNumber: grNo, receiptKind: "unplanned", status: "posted", supplierId: lb.id, supplierName: lb.name, supplierDocumentNumber: "LB-DR-7720", unplannedReasonCode: "no_purchase_order", receivedBy: wh.id, receivedAt: at(24 * 6), postedAt: at(24 * 6), postedBy: wh.id, createdBy: wh.id, createdAt: at(24 * 6), correlationId: uuidv7() }).returning();
    const lotNumber = await nextNo(db, O, "LOT", "L", 5, YYMM);
    const [lot] = await db.insert(s.inventoryLots).values({ organizationId: O, siteId: nfd.id, lotNumber, itemKind: "material", materialId: glx.id, supplierName: lb.name, supplierLotNumber: "LB-GLX-0912", manufacturedOn: day(-30), expiresOn: day(300), qualityStatus: "rejected", baseUom: glx.baseUom, createdBy: wh.id, createdAt: at(24 * 6) }).returning();
    const [mv] = await db.insert(s.stockMovements).values({ organizationId: O, siteId: nfd.id, movementType: "receipt", lotId: lot.id, toLocationId: rej.id, qtyBase: "8000", baseUom: glx.baseUom, sourceDocumentType: "goods_receipt", sourceDocumentId: gr.id, sourceDocumentNumber: grNo, postedBy: wh.id, postedAt: at(24 * 6), idempotencyKey: `gr:${gr.id}:1` }).returning();
    await db.insert(s.inventoryBalances).values({ siteId: nfd.id, lotId: lot.id, locationId: rej.id, qtyBase: "8000" });
    await db.insert(s.goodsReceiptLines).values({ goodsReceiptId: gr.id, lineNo: 1, lotId: lot.id, materialId: glx.id, qtyEntered: "8", uomEntered: "kg", qtyBase: "8000", locationId: rej.id, supplierLotNumber: "LB-GLX-0912", manufacturedOn: day(-30), expiresOn: day(300), containerCount: 1, storageConditionsConfirmed: true, initialQualityStatus: "quarantine", stockMovementId: mv.id, createdBy: wh.id, createdAt: at(24 * 6) });
    await db.insert(s.dispositions).values({ organizationId: O, siteId: nfd.id, subjectType: "lot", subjectId: lot.id, decision: "reject", fromStatus: "quarantine", toStatus: "rejected", reason: "Assay below specification on the incoming test (fictional).", decidedBy: qa.id, decidedAt: at(24 * 4) });
    const returnNumber = await nextNo(db, O, "SRT", "SRT", 4, YY);
    const [sr] = await db.insert(s.supplierReturns).values({ organizationId: O, siteId: nfd.id, returnNumber, status: "submitted", supplierId: lb.id, goodsReceiptId: gr.id, reasonCode: "rejected_at_inspection", reasonNote: "Assay below specification (fictional).", supplierRmaReference: "LB-RMA-0042", creditExpectedAmount: "8800.0000", submittedBy: proc.id, submittedAt: at(20), createdBy: proc.id, createdAt: at(22), statusChangedAt: at(20), statusChangedBy: proc.id }).returning();
    await db.insert(s.supplierReturnLines).values({ organizationId: O, siteId: nfd.id, supplierReturnId: sr.id, lineNo: 1, lotId: lot.id, fromLocationId: rej.id, qtyEntered: "8", uomEntered: "kg", qtyBase: "8000", baseUom: glx.baseUom, creditExpectedAmount: "8800.0000" });
    await db.insert(s.supplierReturnStateTransitions).values([
      { organizationId: O, siteId: nfd.id, supplierReturnId: sr.id, fromState: null, toState: "draft", actorId: proc.id, occurredAt: at(22), correlationId: uuidv7() },
      { organizationId: O, siteId: nfd.id, supplierReturnId: sr.id, fromState: "draft", toState: "submitted", actorId: proc.id, occurredAt: at(20), correlationId: uuidv7() },
    ]);
  }

  // 7. A forecast override waiting for a second person (planner entered it; the site manager approves).
  const [acs] = await db.select().from(s.products).where(and(eq(s.products.organizationId, O), eq(s.products.skuCode, "ACS-135")));
  if (acs) {
    const first = day(0).slice(0, 8) + "01";
    const [y, m] = first.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const after = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
    await db.insert(s.forecastOverrides).values({ organizationId: O, siteId: nfd.id, productId: acs.id, periodStart: nextMonth, periodEnd: after, baselineQtyBase: null, baselineMethod: null, overrideQtyBase: "1500", baseUom: acs.baseUom, reason: "Fictional: a retailer promotion is planned for that month.", status: "submitted", submittedBy: planner.id, submittedAt: at(3) });
  }
  console.log(`W4A seed: PO template, ${pairs.length} approved-list rows, ${Object.keys(pos).length} purchase orders, 2 purchase requests, 1 supplier return.`);
}
