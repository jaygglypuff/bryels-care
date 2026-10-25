/**
 * Wave 4 W4C fictional demo data (runs inside the demo-mode-guarded seed; every name is invented):
 * - a CAPA in progress from the seeded open deviation (one action overdue, for the action centre);
 * - a change control under review (glycerin grade change, waiting for QA approval);
 * - a closed mock recall drill on the shipped batch-1 soap lot (two approvals, notifications, reconciliation);
 * - a soap bar cutter with an overdue preventive-maintenance plan (blocked by the equipment gate), PM plans on
 *   the soap mixer (time) and the mould line (usage), an open PM work order and a corrective work order in
 *   progress on the backup mixer with a spare bearing issued from stock.
 * No technician role exists in the permissions matrix (W13: technicians are site managers or production
 * operators), so no extra demo account is added.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

/** Allocates a demo number on the shared counter (same table and keys as src/lib/numbering.ts). */
async function nextNo(db: Db, organizationId: string, type: string, width: number, periodKey: string, format: (seq: string) => string) {
  const rows = await db.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${type}, ${type}, ${width}, ${periodKey}, 2)
    ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  return format(String(rows[0].value).padStart(width, "0"));
}

export async function seedW4c(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const YYYY = String(manila.getFullYear());
  const YY = YYYY.slice(2);
  const day = (offset: number) => {
    const d = new Date(manila);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  if (!nfd) return;
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const qa = await user("qa.nfd@bryels-care.test");
  const lead = await user("qa.lead@bryels-care.test");
  const manager = await user("manager.nfd@bryels-care.test");
  const operator = await user("operator.nfd@bryels-care.test");
  const owner = await user("owner@bryels-care.test");
  const sales = await user("sales@bryels-care.test");
  const warehouse = await user("warehouse.nfd@bryels-care.test");
  const planner = (await user("planner.nfd@bryels-care.test")) ?? manager;
  if (!qa || !lead || !manager || !operator || !owner || !sales || !warehouse) return;

  /* ---------------------------------------------------------------- 1. CAPA in progress from the open deviation */
  const [dev] = await db.select().from(s.deviations).where(and(eq(s.deviations.siteId, nfd.id), eq(s.deviations.status, "open"))).limit(1);
  if (dev) {
    const capaNumber = await nextNo(db, O, "CAPA", 3, YY, (q) => `CAPA-${YY}-${q}`);
    const [c] = await db
      .insert(s.capas)
      .values({
        organizationId: O,
        siteId: nfd.id,
        capaNumber,
        status: "in_progress",
        sourceKind: "deviation",
        deviationId: dev.id,
        sourceReference: dev.deviationNumber,
        title: "Mixer stops during power dips",
        problemStatement: "The soap mixer paused for about 8 minutes during trace after a power dip; the temperature was not logged during the pause.",
        ownerId: manager.id,
        dueDate: day(21),
        rootCause: "The mixer control panel has no backup power; the operator had no instruction to log temperature during a stop.",
        correctiveAction: "Fit a UPS to the mixer control panel.",
        preventiveAction: "Add a 'log temperature every 2 minutes during any stop' instruction to the soap routing.",
        effectivenessCriteria: "No unlogged mixer stop in the next 10 soap batches (QA to confirm the criterion).",
        createdBy: qa.id,
        createdAt: at(2),
        statusChangedAt: at(1),
        statusChangedBy: manager.id,
      })
      .returning();
    await db.insert(s.capaStateTransitions).values([
      { organizationId: O, siteId: nfd.id, capaId: c.id, fromState: null, toState: "open", actorId: qa.id, reason: c.title, occurredAt: at(2) },
      { organizationId: O, siteId: nfd.id, capaId: c.id, fromState: "open", toState: "in_progress", actorId: manager.id, reason: "Action 1 added", occurredAt: at(1) },
    ]);
    await db.insert(s.capaActions).values([
      { organizationId: O, siteId: nfd.id, capaId: c.id, actionNo: 1, actionKind: "corrective", description: "Fit a UPS (fictional supplier quote Q-118) to the soap mixer control panel.", ownerId: manager.id, dueDate: day(14), verificationMethod: "QA checks the installation and a switch-over test with mains off.", createdBy: manager.id, createdAt: at(1) },
      { organizationId: O, siteId: nfd.id, capaId: c.id, actionNo: 2, actionKind: "preventive", description: "Draft the routing change: log temperature every 2 minutes during any mixer stop.", ownerId: qa.id, dueDate: day(-2), verificationMethod: "Change control approved and the routing revision effective.", createdBy: qa.id, createdAt: at(1) },
    ]);
  }

  /* ---------------------------------------------------------------- 2. Change control under review */
  const ccNumber = await nextNo(db, O, "CC", 3, YY, (q) => `CC-${YY}-${q}`);
  const [cc] = await db
    .insert(s.changeControls)
    .values({
      organizationId: O,
      siteId: nfd.id,
      changeNumber: ccNumber,
      status: "submitted",
      title: "Switch glycerin to the vegetable USP grade from Laguna Oleo Supply",
      description: "Replace the current glycerin with the vegetable-origin USP grade in the soap and lotion formulas (new formula revisions).",
      justification: "Current supplier discontinues the grade (fictional demo scenario).",
      entityType: "formula_revision",
      riskLevel: "medium",
      impactAssessment: "Product: equivalent specification, QA to compare CoAs. Stability: confirmatory check on the first batch. Labels: INCI name unchanged. Stock: use up current lots first. Documents: formula revisions for ACS-135 and AHL-250.",
      implementationPlan: "Approve the change, create the formula revisions, approve them through the formula workflow, first batch under QA watch.",
      targetDate: day(30),
      submittedBy: qa.id,
      submittedAt: at(5),
      createdBy: planner.id,
      createdAt: at(26),
      statusChangedAt: at(5),
      statusChangedBy: qa.id,
    })
    .returning();
  await db.insert(s.changeControlStateTransitions).values([
    { organizationId: O, siteId: nfd.id, changeControlId: cc.id, fromState: null, toState: "draft", actorId: planner.id, reason: cc.title, occurredAt: at(26) },
    { organizationId: O, siteId: nfd.id, changeControlId: cc.id, fromState: "draft", toState: "submitted", actorId: qa.id, occurredAt: at(5) },
  ]);

  /* ---------------------------------------------------------------- 3. Closed mock recall drill on the shipped batch-1 lot */
  const [shipMv] = await db
    .select({ m: s.stockMovements, sh: s.shipments, customerId: s.salesOrders.customerId })
    .from(s.stockMovements)
    .innerJoin(s.shipments, eq(s.shipments.id, s.stockMovements.sourceDocumentId))
    .innerJoin(s.salesOrders, eq(s.salesOrders.id, s.shipments.salesOrderId))
    .where(and(eq(s.stockMovements.organizationId, O), eq(s.stockMovements.siteId, nfd.id), eq(s.stockMovements.movementType, "shipment"), eq(s.stockMovements.sourceDocumentType, "shipment")))
    .orderBy(s.stockMovements.postedAt)
    .limit(1);
  if (shipMv) {
    const [lot] = await db.select().from(s.inventoryLots).where(eq(s.inventoryLots.id, shipMv.m.lotId));
    const [ret] = (await db.execute(sql`
      select coalesce(sum(l.qty_base), 0)::text as qty from customer_return_lines l join customer_returns r on r.id = l.customer_return_id
      where r.shipment_id = ${shipMv.sh.id} and l.lot_id = ${lot.id} and l.stock_movement_id is not null and r.status <> 'cancelled'`)) as unknown as { qty: string }[];
    const shipped = Number(shipMv.m.qtyBase);
    const returned = Number(ret?.qty ?? 0);
    const rcNumber = await nextNo(db, O, "RC", 2, YY, (q) => `RC-${YYYY}-${q}`);
    const opened = at(24 * 20);
    const [rc] = await db
      .insert(s.recallCases)
      .values({
        organizationId: O,
        originSiteId: nfd.id,
        recallNumber: rcNumber,
        status: "closed",
        recallKind: "mock",
        title: "Mock recall drill: Acapulco soap batch 1",
        description: "Annual traceability drill (fictional): trace the first Acapulco soap lot to every customer and confirm where every bar is. No stock is marked.",
        classification: "Drill (not a regulatory recall)",
        regulatoryNotes: "No authority notification for a drill. Real recall obligations are defined by the company's QA / regulatory personnel.",
        subjectCode: lot.lotNumber,
        subjectKind: "lot",
        traceMode: "forward",
        scopeAsOf: opened,
        openedBy: qa.id,
        openedAt: opened,
        submittedBy: qa.id,
        submittedAt: at(24 * 20 - 1),
        approvedAt: at(24 * 20 - 3),
        markedBy: qa.id,
        markedAt: at(24 * 20 - 4),
        recoveryStartedAt: at(24 * 19),
        closedBy: qa.id,
        closedAt: at(24 * 18),
        closureReport: "Drill completed in 26 hours: 1 lot, 1 customer, every bar accounted for (returned to the RET-01 cage or confirmed on the customer's shelves). Improvement: keep the customer contact list current.",
        statusChangedAt: at(24 * 18),
        statusChangedBy: qa.id,
        createdAt: opened,
      })
      .returning();
    await db.insert(s.recallCaseLots).values({ organizationId: O, recallCaseId: rc.id, lotId: lot.id, siteId: lot.siteId, traceRole: "start", statusAtOpening: lot.qualityStatus, onHandAtOpening: "0", uomBase: lot.baseUom, outcome: "not_marked", note: "Mock recall: stock is not marked." });
    await db.insert(s.recallCaseCustomers).values({
      organizationId: O,
      recallCaseId: rc.id,
      customerId: shipMv.customerId,
      shipmentId: shipMv.sh.id,
      lotId: lot.id,
      siteId: nfd.id,
      drNumber: shipMv.sh.deliveryReceiptNumber ?? "(no DR)",
      qtyShippedBase: String(shipped),
      qtyReturnedBase: String(returned),
      qtyAccountedBase: String(Math.max(0, shipped - returned)),
      uomBase: lot.baseUom,
      notifiedAt: at(24 * 20 - 5),
      notifiedBy: sales.id,
      notificationMethod: "phone",
      acknowledgedAt: at(24 * 20 - 2),
      accountedNote: "Drill: the buyer counted the remaining bars on the shelves (fictional).",
      note: "Drill call, buyer informed it was an exercise.",
    });
    await db.insert(s.approvalDecisions).values([
      { organizationId: O, recordType: "recall_case", recordId: rc.id, step: 1, decision: "approved", decidedBy: lead.id, decidedAt: at(24 * 20 - 2), note: "Drill scope checked" },
      { organizationId: O, recordType: "recall_case", recordId: rc.id, step: 2, decision: "approved", decidedBy: owner.id, decidedAt: at(24 * 20 - 3), note: "Go for the drill" },
    ]);
    const steps: [string | null, string, string, number][] = [
      [null, "draft", qa.id, 24 * 20],
      ["draft", "submitted", qa.id, 24 * 20 - 1],
      ["submitted", "approved", owner.id, 24 * 20 - 3],
      ["approved", "notifying", qa.id, 24 * 20 - 4],
      ["notifying", "recovering", qa.id, 24 * 19],
      ["recovering", "closed", qa.id, 24 * 18],
    ];
    await db.insert(s.recallCaseStateTransitions).values(steps.map(([from, to, by, h]) => ({ organizationId: O, recallCaseId: rc.id, fromState: from, toState: to, actorId: by, occurredAt: at(h), reason: to === "notifying" ? "Drill started: no stock marked" : null })));
  }

  /* ---------------------------------------------------------------- 4. Maintenance: spare parts, cutter, PM plans, work orders */
  const [pkg] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, "PKG-01")));
  const eqByCode = async (code: string) => (await db.select().from(s.equipment).where(and(eq(s.equipment.organizationId, O), eq(s.equipment.code, code))))[0];
  const mix1 = await eqByCode("MIX-01");
  const mix2 = await eqByCode("MIX-02");
  const mld1 = await eqByCode("MLD-01");
  if (!pkg || !mix1 || !mix2 || !mld1) return;

  const [cutter] = await db
    .insert(s.equipment)
    .values({
      organizationId: O,
      siteId: nfd.id,
      code: "CUT-01",
      name: "Soap bar cutter (wire)",
      equipmentKind: "cutter",
      lineLabel: mix1.lineLabel ?? "Soap line 1",
      productionLineId: mix1.productionLineId,
      status: "in_service",
      maintenanceIntervalDays: 30,
      maintenanceDueDate: day(-3),
      lastMaintainedDate: day(-33),
      cleaningStatus: "clean",
      cleaningRule: "per_changeover",
      lastCleanedAt: at(20),
      responsibleUserId: manager.id,
      statusChangedBy: manager.id,
      statusChangedAt: at(24 * 120),
      createdBy: manager.id,
      createdAt: at(24 * 120),
    })
    .returning();
  await db.insert(s.equipmentStateTransitions).values({ organizationId: O, siteId: nfd.id, equipmentId: cutter.id, fromState: null, toState: "in_service", actorId: manager.id, reason: "Registered", occurredAt: at(24 * 120) });

  const [bearing, wire] = await db
    .insert(s.materials)
    .values([
      { organizationId: O, code: "SPR-0001", name: "Mixer output bearing 6205-2RS (spare)", materialKind: "consumable", baseUom: "pcs" },
      { organizationId: O, code: "SPR-0002", name: "Cutter wire 0.8 mm, 10 m roll (spare)", materialKind: "consumable", baseUom: "pcs" },
    ])
    .returning();
  const spareLot = async (lotNumber: string, materialId: string, qty: number) => {
    const [l] = await db.insert(s.inventoryLots).values({ organizationId: O, siteId: nfd.id, lotNumber, itemKind: "material", materialId, supplierName: "Calamba Industrial Parts (fictional)", qualityStatus: "released", baseUom: "pcs", createdBy: warehouse.id, createdAt: at(24 * 40) }).returning();
    await db.insert(s.stockMovements).values({ organizationId: O, siteId: nfd.id, movementType: "receipt", lotId: l.id, toLocationId: pkg.id, qtyBase: String(qty), baseUom: "pcs", qualityStatusAtPosting: "released", sourceDocumentType: "demo_seed", sourceDocumentNumber: lotNumber, reason: "Demo spare parts receipt (fictional)", postedBy: warehouse.id, postedAt: at(24 * 40) });
    return l;
  };
  const bearingLot = await spareLot("L-DEMO-SPR-01", bearing.id, 4);
  const wireLot = await spareLot("L-DEMO-SPR-02", wire.id, 6);
  await db.insert(s.inventoryBalances).values([
    { siteId: nfd.id, lotId: bearingLot.id, locationId: pkg.id, qtyBase: "3" },
    { siteId: nfd.id, lotId: wireLot.id, locationId: pkg.id, qtyBase: "6" },
  ]);
  await db.insert(s.maintenanceSpareParts).values([
    { organizationId: O, siteId: nfd.id, materialId: bearing.id, equipmentId: null, minQtyBase: "2", note: "Fits both soap mixers.", createdBy: manager.id },
    { organizationId: O, siteId: nfd.id, materialId: wire.id, equipmentId: cutter.id, minQtyBase: "2", note: "Change the wire at every PM.", createdBy: manager.id },
  ]);

  const pmNo = async () => nextNo(db, O, "PM", 4, "", (q) => `PM-${q}`);
  await db
    .insert(s.maintenancePlans)
    .values({ organizationId: O, siteId: nfd.id, equipmentId: mix1.id, planNumber: await pmNo(), title: "Mixer gearbox oil, seals and paddle check", instructions: "Drain and refill gearbox oil (grade per the fictional manual), check paddle seals, test the emergency stop.", triggerKind: "time", intervalDays: 180, nextDueOn: mix1.maintenanceDueDate ?? day(60), responsibleUserId: manager.id, usageSince: at(24 * 120), lastCompletedAt: at(24 * 120), createdBy: manager.id, createdAt: at(24 * 150) });
  const [pmCutter] = await db
    .insert(s.maintenancePlans)
    .values({ organizationId: O, siteId: nfd.id, equipmentId: cutter.id, planNumber: await pmNo(), title: "Cutter wire change and tension check", instructions: "Replace the wire (SPR-0002), set the tension, check bar length on 10 bars.", triggerKind: "time", intervalDays: 30, nextDueOn: day(-3), responsibleUserId: operator.id, usageSince: at(24 * 33), lastCompletedAt: at(24 * 33), createdBy: manager.id, createdAt: at(24 * 120) })
    .returning();
  await db
    .insert(s.maintenancePlans)
    .values({ organizationId: O, siteId: nfd.id, equipmentId: mld1.id, planNumber: await pmNo(), title: "Mould frame inspection every 40 batches", instructions: "Inspect frames for cracks and warping; replace damaged frames.", triggerKind: "usage", usageMetric: "batches", usageInterval: "40", responsibleUserId: manager.id, usageSince: at(24 * 60), createdBy: manager.id, createdAt: at(24 * 60) });

  const mwoNo = async () => nextNo(db, O, "MWO", 4, YY, (q) => `MWO-${YY}-${q}`);
  // Corrective work order in progress on the backup mixer (already out of service in the W1D seed), bearing issued.
  const [mwoA] = await db
    .insert(s.maintenanceWorkOrders)
    .values({ organizationId: O, siteId: nfd.id, equipmentId: mix2.id, workOrderNumber: await mwoNo(), kind: "corrective", status: "in_progress", priority: "high", title: "Gearbox noise: replace the output bearing", description: "Grinding noise from the gearbox under load (reported with the downtime event).", dueDate: day(1), assignedTo: manager.id, takesEquipmentDown: true, reportedDown: true, startedAt: at(24 * 3), startedBy: manager.id, createdBy: manager.id, createdAt: at(24 * 4), statusChangedAt: at(24 * 3), statusChangedBy: manager.id })
    .returning();
  await db.insert(s.maintenanceWorkOrderStateTransitions).values([
    { organizationId: O, siteId: nfd.id, workOrderId: mwoA.id, fromState: null, toState: "open", actorId: manager.id, reason: mwoA.title, occurredAt: at(24 * 4) },
    { organizationId: O, siteId: nfd.id, workOrderId: mwoA.id, fromState: "open", toState: "in_progress", actorId: manager.id, reason: "Work started", occurredAt: at(24 * 3) },
  ]);
  const [issue] = await db
    .insert(s.stockMovements)
    .values({ organizationId: O, siteId: nfd.id, movementType: "issue", lotId: bearingLot.id, fromLocationId: pkg.id, qtyBase: "1", baseUom: "pcs", qualityStatusAtPosting: "released", sourceDocumentType: "maintenance_work_order", sourceDocumentId: mwoA.id, sourceDocumentNumber: mwoA.workOrderNumber, reason: "maintenance spare part", postedBy: warehouse.id, postedAt: at(24 * 3 - 1) })
    .returning();
  await db.insert(s.maintenanceWorkOrderParts).values({ organizationId: O, siteId: nfd.id, workOrderId: mwoA.id, materialId: bearing.id, lotId: bearingLot.id, fromLocationId: pkg.id, qtyBase: "1", uomBase: "pcs", stockMovementId: issue.id, issuedBy: warehouse.id, issuedAt: at(24 * 3 - 1) });
  // Open preventive work order of the overdue cutter plan.
  const [mwoB] = await db
    .insert(s.maintenanceWorkOrders)
    .values({ organizationId: O, siteId: nfd.id, equipmentId: cutter.id, planId: pmCutter.id, workOrderNumber: await mwoNo(), kind: "preventive", status: "open", priority: "normal", title: `${pmCutter.planNumber}: ${pmCutter.title}`, description: pmCutter.instructions, dueDate: day(-3), assignedTo: operator.id, takesEquipmentDown: true, createdBy: manager.id, createdAt: at(24 * 5), statusChangedAt: at(24 * 5), statusChangedBy: manager.id })
    .returning();
  await db.insert(s.maintenanceWorkOrderStateTransitions).values({ organizationId: O, siteId: nfd.id, workOrderId: mwoB.id, fromState: null, toState: "open", actorId: manager.id, reason: mwoB.title, occurredAt: at(24 * 5) });
}
