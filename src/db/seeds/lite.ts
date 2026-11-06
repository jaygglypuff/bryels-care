/**
 * The lite demo profile (src/db/seed-demo.ts; docs/demo-script.md). Fictional data only.
 *
 * Part A — setup the company needs before anyone works (written directly, like the other seeds): the
 * organization, ONE site (North Fields Plant, NFD) with its warehouse and shelves, the role templates,
 * the demo accounts (password demo1234), units and reason codes, the approved print layouts (labels incl.
 * product and carton kinds with "Made", BMR, sheets, pick list, delivery receipt, PO), a label printer,
 * the approval rules, the scale / mixer / filler, three suppliers with their approved-supplier list, two
 * customers and a finished-product check plan per product (placeholder values for QA to confirm).
 *
 * Part B — everything else goes through the real services, the same commands the screens run (same
 * rules, numbers, stock postings and audit): the materials and the two products with their recipe and
 * steps (the recipe wizard, by pieces, packaging per piece, approved by QA and the site manager), the
 * opening stock (received, released by QA, put on shelves), two purchase orders, four production
 * orders at different steps and two customer orders. The storyline:
 *
 *   | What                               | Where it stops                                         |
 *   |------------------------------------|--------------------------------------------------------|
 *   | Purchase order to Manila Print     | sent to the supplier                                   |
 *   | Purchase order to Laguna Oleo      | delivered; coconut oil released → waiting to put away; |
 *   |                                    | glycerin waiting for the QA check                      |
 *   | Acapulco Soap order 1              | made, QA passed, 5 boxes on the finished goods bay     |
 *   | Aloe Hand Lotion order 1           | made, waiting for the QA check in the hold area        |
 *   | Acapulco Soap order 2              | batch in progress: weighed, heated and mixed           |
 *   |                                    | (next step: Pour into moulds)                          |
 *   | Aloe Hand Lotion order 2           | approved, ready for "Get materials"                    |
 *   | Customer order Luntian (soap)      | stock set aside: ready to get from the shelf           |
 *   | Customer order Isla Spa (lotion)   | confirmed, waiting for released lotion                 |
 *
 * The only shortcut: soap must cure (2 days, a demo value). For the finished soap batch the cure step's
 * start and "ready at" times are moved two days back after it was started through the service, as if the
 * batch had been made two days ago; nothing else is written around the services.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import Decimal from "decimal.js";
import { db } from "../client";
import * as s from "../schema";
import { DEMO_PASSWORD, DEMO_SEED_VERSION } from "../../lib/demo";
import { ROLE_BUNDLES } from "../../lib/permissions";
import { buildContextForUser, type AuthContext } from "../../lib/auth/context";
import { definitionChecksum } from "../../modules/documents/checksum";
import { dispensingSheetRendererV1 } from "../../modules/documents/renderers/dispensing-sheet-v1";
import { travelerRendererV1 } from "../../modules/documents/renderers/traveler-v1";
import { purchaseOrderRendererV1 } from "../../modules/documents/renderers/purchase-order-v1";
import { DEFAULT_APPROVAL_RULES } from "../../modules/governance/default-rules";
import { installReferenceData } from "../../modules/masterdata/org-reference";
import { seedW1e } from "./w1e";
import { seedW2d } from "./w2d";
import { seedW3e } from "./w3e";

type Db = Parameters<typeof seedW1e>[0];

export const LITE_ORG_NAME = "Bryel's Care Corporation (demo)";
export const LITE_SOAP = "Acapulco Soap 135 g";
export const LITE_LOTION = "Aloe Hand Lotion 250 mL";

const DAY = 86_400_000;
const manilaDay = (offset = 0) => new Date(Date.now() + offset * DAY).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const key = () => randomUUID();

/** [email, name, role, organization-wide] — the same addresses as the full demo, so sign-in habits keep working. */
export const LITE_PEOPLE: [string, string, keyof typeof ROLE_BUNDLES, boolean][] = [
  ["owner@bryels-care.test", "Ana Villanueva", "owner_director", true],
  ["admin@bryels-care.test", "Paolo Reyes", "system_admin", true],
  ["manager.nfd@bryels-care.test", "Dino Reyes", "site_manager", false],
  ["planner.nfd@bryels-care.test", "Cora Villamor", "production_planner", false],
  ["operator.nfd@bryels-care.test", "Rhea Mendoza", "production_operator", false],
  ["checker.nfd@bryels-care.test", "Jun Dela Cruz", "production_operator", false],
  ["warehouse.nfd@bryels-care.test", "Lito Pascual", "warehouse_operator", false],
  ["qa.nfd@bryels-care.test", "Nina Quiambao", "qa_qc", false],
  ["qa.lead@bryels-care.test", "Teresa Ocampo", "qa_qc", false],
  ["procurement@bryels-care.test", "Joy Navarro", "procurement", false],
  ["sales@bryels-care.test", "Mara Santos", "sales_cs", false],
  ["finance@bryels-care.test", "Rosa Lim", "finance", false],
  ["floor.nfd@bryels-care.test", "Floor TV North Fields", "floor_display", false],
];

/** Shelves and areas of the one warehouse: [code, plain name, kind, section, special role]. */
const PLACES: [string, string, string, string | null, string | null][] = [
  ["RCV", "Receiving dock", "receiving", null, "receiving"],
  ["QUA-01", "QA waiting area", "quarantine", "qa_hold", "quarantine"],
  ["HLD-01", "Stopped-by-QA cage", "hold", "qa_hold", "hold"],
  ["REJ", "Rejected goods cage", "rejected", "qa_hold", "rejected"],
  ["RM-01", "Oils rack", "storage", "raw_materials", null],
  ["RM-02", "Extracts and liquids shelf", "storage", "raw_materials", null],
  ["PKG-01", "Packaging shelf", "storage", "packaging", null],
  ["PRD-01", "Making room", "production", "production", null],
  ["FG-01", "Finished goods bay", "storage", "finished_goods", null],
  ["SHP", "Sending-out bay", "shipping", null, null],
];

type Ctxs = Record<"owner" | "manager" | "planner" | "operator" | "checker" | "warehouse" | "qa" | "qaLead" | "procurement" | "sales", AuthContext>;

export async function seedLiteDemo(): Promise<string[]> {
  const notes: string[] = [];
  const { registerAppHooks } = await import("../../modules/wiring");
  registerAppHooks();
  const A = await setup(db as unknown as Db);
  notes.push(`setup: 1 site, ${LITE_PEOPLE.length} accounts, ${PLACES.length} places`);
  const c = A.ctx;

  /* ---------------------------------------------------------------- materials, products, recipes */
  const md = await import("../../modules/masterdata");
  // The same createMaterial command as the wizard's "Add a new ingredient / packaging item", with one demo
  // difference: no certificate (CoA) file is attached in the demo, so "needs a certificate" is off (assumption
  // A-DEMO-LITE-02; QA turns it on per material under More details).
  const mat = async (name: string, inciName: string | null, kind: "raw_material" | "packaging") =>
    (await md.createMaterialMaster(c.planner, { code: null, name, inciName, materialKind: kind, baseUom: kind === "packaging" ? "pcs" : "g", status: "active", requiresCoa: false })).id;
  const ing = (name: string, inciName: string) => mat(name, inciName, "raw_material");
  const pkg = (name: string) => mat(name, null, "packaging");
  const M = {
    coconut: await ing("Coconut Oil", "Cocos Nucifera (Coconut) Oil"),
    palm: await ing("Palm Oil", "Elaeis Guineensis (Palm) Oil"),
    lye: await ing("Lye Solution 33%", "Sodium Hydroxide (aqueous)"),
    extract: await ing("Acapulco Leaf Extract", "Cassia Alata Leaf Extract"),
    green: await ing("Green Soap Colour", "Chromium Oxide Greens"),
    water: await ing("Purified Water", "Aqua"),
    aloe: await ing("Aloe Vera Juice", "Aloe Barbadensis Leaf Juice"),
    glycerin: await ing("Glycerin", "Glycerin"),
    cetearyl: await ing("Cetearyl Alcohol", "Cetearyl Alcohol"),
    wrapper: await pkg("Soap Wrapper 135 g"),
    bottle: await pkg("Lotion Bottle 250 mL"),
    cap: await pkg("Pump Cap"),
    box: await pkg("Shipping Box (holds 24)"),
  };
  const soap = await md.createRecipeProduct(c.planner, { name: LITE_SOAP, sizeG: "135", family: "Soap", unitsPerBox: "24", shelfLifeMonths: "24" });
  const lotion = await md.createRecipeProduct(c.planner, { name: LITE_LOTION, sizeG: "255", family: "Lotion", unitsPerBox: "24", shelfLifeMonths: "18" });
  // ADR-104 §2: the soap gets one label per box (default), the lotion one label on each bottle.
  await md.updateProduct(c.owner, lotion.id, { code: null, name: LITE_LOTION, family: "Lotion", unitNetMassG: "255", unitsPerBox: 24, shelfLifeDays: null, shelfLifeMonths: 18, storageConditions: "Store below 30 °C, away from sunlight", labelling: "per_piece" });
  await md.updateProduct(c.owner, soap.id, { code: null, name: LITE_SOAP, family: "Soap", unitNetMassG: "135", unitsPerBox: 24, shelfLifeDays: null, shelfLifeMonths: 24, storageConditions: "Store in a cool, dry place", labelling: "per_box" });
  await addCheckPlans(A, soap.id, lotion.id);

  const line = (materialId: string, pct: string) => ({ materialId, amount: pct, src: "pct" as const, diffKind: "pct" as const, diff: "1", needsCheck: true, phaseCode: null, scaling: "proportional" as const, isCritical: true });
  const perPiece = (materialId: string) => ({ materialId, perPiece: "1", from: null, keep: md.packagingKeep() });
  const boxes = (materialId: string, qty: string, pieces: string) => ({ materialId, perPiece: "", from: { qty, pieces }, keep: md.packagingKeep() });
  const step = (block: Parameters<typeof md.newStep>[0], over: Record<string, unknown> = {}) => ({ ...md.newStep(block), ...over });
  const clean = () =>
    step("clean", {
      name: "Check the area is clean",
      checklist: [
        { text: "Nothing from the last batch is left (materials, labels, papers)", requiresPhoto: false, isBlocking: true },
        { text: "Tables, pots and tools are clean", requiresPhoto: false, isBlocking: true },
      ],
    });
  const temp = (name: string, min: string, max: string) => [{ name, kind: "number" as const, unit: "°C", min, max, target: "", code: "", required: true }];
  const soapSteps = [
    clean(),
    step("weigh", { name: "Weigh the ingredients", instruction: "Weigh each ingredient. One person weighs, a second person checks." }),
    step("heat", { name: "Heat and mix", instruction: "Warm the oils, then mix in the lye solution slowly until it thickens. Add the extract and the colour.", readings: temp("Oil temperature", "40", "60") }),
    step("pour", { name: "Pour into moulds", instruction: "Pour the mix into the moulds." }),
    step("wait", { name: "Cure", instruction: "Leave the moulds alone until the soap is hard (demo value: 2 days; QA sets the real time).", waitAmount: "2", waitUnit: "days" }),
    step("cut", { name: "Cut", instruction: "Cut the block into 135 g bars." }),
    step("wrap", { name: "Wrap and pack", instruction: "Wrap each bar and pack 24 bars in a box. Stick one label on each box." }),
    step("move", { name: "Move to the hold area", instruction: "Put the boxes in the QA waiting area until QA says OK." }),
  ];
  const lotionSteps = [
    clean(),
    step("weigh", { name: "Weigh", instruction: "Weigh each ingredient. One person weighs, a second person checks." }),
    step("heat", { name: "Heat and mix", instruction: "Heat the water and the oil part, then mix them until smooth.", readings: temp("Mix temperature", "65", "75") }),
    step("cool", { name: "Cool", instruction: "Let it cool, then stir in the aloe.", readings: temp("Temperature after cooling", "25", "40") }),
    // A plain making step, not the "Fill bottles" block: the bottles, caps and boxes are recorded once, on
    // "Label and pack" (a routing with both a filling and a packaging step blocks the second one when every
    // taken item was recorded on the first; reported in the hand-off as a product gap).
    step("other", { name: "Fill bottles", instruction: "Fill each bottle and close it with a pump cap." }),
    step("wrap", { name: "Label and pack", instruction: "Stick a label on each bottle and pack 24 bottles in a box." }),
    step("move", { name: "Move to the hold area", instruction: "Put the boxes in the QA waiting area until QA says OK." }),
  ];
  const recipe = async (productId: string, pieces: string, expectedPct: string, lines: ReturnType<typeof line>[], packaging: unknown[], steps: unknown[]) => {
    const r = await md.saveRecipe(c.planner, {
      productId,
      formulaId: null,
      routingId: null,
      batchBy: "pcs",
      pieces,
      pieceG: "",
      packaging,
      batchKg: "",
      expectedPct,
      view: "pct",
      lines,
      steps,
      changeSummary: "",
      useFrom: "",
      formulaNotes: "Demo recipe with fictional amounts. Verify with authorized personnel before production use.",
      routingNotes: "",
      submit: true,
      activateProduct: false,
    });
    // Two approvals: QA, then the site manager (the default approval rules).
    for (const who of [c.qa, c.manager]) {
      await md.decideFormulaRevision(who, { id: r.formula.revisionId, decision: "approved" });
      await md.decideRoutingRevision(who, { id: r.routing!.revisionId, decision: "approved" });
    }
    return r;
  };
  await recipe(soap.id, "120", "95", [line(M.coconut, "21.2"), line(M.palm, "49.4"), line(M.lye, "28.2"), line(M.extract, "1.0"), line(M.green, "0.2")], [perPiece(M.wrapper), boxes(M.box, "5", "120")], soapSteps);
  await recipe(lotion.id, "96", "97", [line(M.water, "71.0"), line(M.aloe, "15.0"), line(M.glycerin, "6.0"), line(M.cetearyl, "8.0")], [perPiece(M.bottle), perPiece(M.cap), boxes(M.box, "4", "96")], lotionSteps);
  notes.push("2 products, 2 recipes, 2 routings approved through the recipe wizard");

  /* ---------------------------------------------------------------- suppliers' approved list */
  await approvedSupplierList(A, M);

  /* ---------------------------------------------------------------- opening stock */
  const inv = await import("../../modules/inventory");
  const receiving = await import("../../modules/inventory/receiving");
  const quality = await import("../../modules/quality");
  const lotOfLine = async (receiptId: string, supplierLot: string) => {
    const [l] = await db.select({ lot: s.inventoryLots }).from(s.goodsReceiptLines).innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.goodsReceiptLines.lotId)).where(and(eq(s.goodsReceiptLines.goodsReceiptId, receiptId), eq(s.inventoryLots.supplierLotNumber, supplierLot)));
    return l.lot;
  };
  type Opening = { m: string; qty: string; uom: string; sLot: string; exp: number; shelf: string };
  const opening = async (supplier: string, doc: string, lines: Opening[]) => {
    const r = await receiving.receiveAndPost(c.warehouse, {
      idempotencyKey: key(),
      supplierId: A.suppliers[supplier],
      supplierDocumentNumber: doc,
      unplannedReasonCode: "opening_balance",
      notes: "Opening stock of the demo (fictional).",
      lines: lines.map((l) => ({ materialId: l.m, qty: l.qty, uom: l.uom, supplierLotNumber: l.sLot, expiresOn: manilaDay(l.exp), locationId: A.places["QUA-01"], storageConditionsConfirmed: true })),
    });
    for (const l of lines) {
      const lot = await lotOfLine(r.receiptId, l.sLot);
      await quality.decideLot(c.qa, { lotId: lot.id, decision: "release", reason: "Certificate checked; looks and smells right (demo)." });
      await inv.putAwayLot(c.warehouse, { lotRef: lot.lotNumber, locationRef: l.shelf, idempotencyKey: key() });
    }
  };
  await opening("Laguna Oleo Supply", "LOS-DR-1001", [
    { m: M.coconut, qty: "25", uom: "kg", sLot: "LOS-24871", exp: 600, shelf: "RM-01" },
    // Near expiry: the palm oil to use first.
    { m: M.palm, qty: "20", uom: "kg", sLot: "LOS-24872", exp: 20, shelf: "RM-01" },
    { m: M.palm, qty: "50", uom: "kg", sLot: "LOS-25110", exp: 480, shelf: "RM-01" },
    { m: M.lye, qty: "30", uom: "kg", sLot: "LOS-LYE-311", exp: 120, shelf: "RM-02" },
    { m: M.glycerin, qty: "10", uom: "kg", sLot: "LOS-GLY-077", exp: 700, shelf: "RM-02" },
    { m: M.cetearyl, qty: "10", uom: "kg", sLot: "LOS-CA-090", exp: 700, shelf: "RM-02" },
  ]);
  await opening("Laguna Botanicals", "LB-DR-2001", [
    { m: M.extract, qty: "2", uom: "kg", sLot: "LB-7712", exp: 300, shelf: "RM-02" },
    { m: M.green, qty: "0.5", uom: "kg", sLot: "LB-GRN-311", exp: 360, shelf: "RM-02" },
    { m: M.aloe, qty: "20", uom: "kg", sLot: "LB-ALO-2210", exp: 200, shelf: "RM-02" },
    { m: M.water, qty: "100", uom: "kg", sLot: "LB-PW-1015", exp: 90, shelf: "RM-02" },
  ]);
  await opening("Manila Print & Pack", "MPP-DR-3001", [
    { m: M.wrapper, qty: "1000", uom: "pcs", sLot: "MPP-889", exp: 1800, shelf: "PKG-01" },
    { m: M.bottle, qty: "400", uom: "pcs", sLot: "MPP-B250-12", exp: 1800, shelf: "PKG-01" },
    { m: M.cap, qty: "400", uom: "pcs", sLot: "MPP-CAP-12", exp: 1800, shelf: "PKG-01" },
    { m: M.box, qty: "60", uom: "pcs", sLot: "MPP-BOX-24", exp: 1800, shelf: "PKG-01" },
  ]);
  // The "ready — put it on a shelf" messages of the opening stock are done (it is on the shelves): each person
  // marks them read, as they would after doing the job, so Home and Messages show only today's storyline.
  const { listMyNotifications, markNotificationRead } = await import("../../modules/platform/notifications");
  for (const who of Object.values(c)) {
    for (const n of await listMyNotifications(who)) if (n.kind === "inventory.lot.ready_to_put_away") await markNotificationRead(who, n.id);
  }
  notes.push("opening stock received, released and put on the shelves");

  /* ---------------------------------------------------------------- production */
  const prod = await import("../../modules/production");
  const newOrder = async (productId: string) => {
    const r = await prod.createProductionOrder(c.planner, { productId, plannedStart: manilaDay(0), idempotencyKey: key() });
    const a = await prod.approveProductionOrder(c.manager, r.workOrderId, { idempotencyKey: key() });
    return { workOrderId: r.workOrderId, batchId: a.batches[0].batchId };
  };
  const snapshot = async (batchId: string) => {
    const [b] = await db.select().from(s.batches).where(eq(s.batches.id, batchId));
    return [...(b.formulaSnapshot as { steps: { stepNo: number; stepKind: string; name: string; checklistItems?: { id: string }[]; parameters?: { id: string; isRequired: boolean; minValue?: string | null; maxValue?: string | null }[] }[] }).steps].sort((x, y) => x.stepNo - y.stepNo);
  };
  const readingsFor = (st: Awaited<ReturnType<typeof snapshot>>[number]) =>
    (st.parameters ?? []).filter((p) => p.isRequired).map((p) => ({ parameterId: p.id, value: p.minValue && p.maxValue ? new Decimal(p.minValue).plus(p.maxValue).div(2).toString() : (p.minValue ?? "1") }));

  /** The cleaning record of each piece of equipment since its last use (the W13 rule), as the operator does on the Equipment screen. */
  const cleanAll = async () => {
    for (const e of await db.select().from(s.equipment).where(eq(s.equipment.organizationId, A.orgId))) {
      if (e.cleaningStatus !== "clean") await md.recordServiceRecord(c.operator, { equipmentId: e.id, serviceKind: "cleaning", result: "completed" });
    }
  };
  /** Runs the batch from "Get materials" up to (not including) the first step whose name is `stopBefore`. */
  const work = async (batchId: string, opts: { stopBefore?: string; boxPieces?: number } = {}) => {
    await prod.confirmPicked(c.operator, { batchId, all: true, idempotencyKey: key() });
    await cleanAll();
    for (const st of await snapshot(batchId)) {
      if (opts.stopBefore && st.name === opts.stopBefore) return;
      if (st.stepKind === "line_clearance") {
        await prod.submitChecklist(c.operator, { batchId, stepNo: st.stepNo, answers: (st.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker: c.checker });
      } else if (st.stepKind === "dispensing") {
        const v = await prod.getWeighView(c.operator, batchId);
        for (const card of v.cards) {
          if (card.done) continue;
          const lot = card.lots[0];
          await prod.recordDispense(c.operator, { batchId, batchMaterialId: card.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, lotPreselected: true, lotConfirm: lot.last4, qty: card.target, equipmentRef: "SC-01" }, { checker: c.checker });
        }
        await prod.completeStep(c.operator, { batchId, stepNo: st.stepNo }, { checker: c.checker });
      } else if (st.stepKind === "transfer") {
        return;
      } else {
        if (st.stepKind === "curing") {
          // The demo shortcut (see the header): the cure was started by the service when the pour was done;
          // move its start and "ready at" two days back so the batch can go on today.
          const back = new Date(Date.now() - 2 * DAY - 60_000);
          await db
            .update(s.processStepRecords)
            .set({ startedAt: back, earliestCompletionAt: new Date(Date.now() - 60_000) })
            .where(and(eq(s.processStepRecords.batchId, batchId), eq(s.processStepRecords.stepNo, st.stepNo)));
        }
        if (st.stepKind === "packaging" && opts.boxPieces) await prod.planBatchBoxes(c.operator, { batchId, pieces: opts.boxPieces, idempotencyKey: key() });
        const r = await prod.stepDone(c.operator, { batchId, stepNo: st.stepNo, readings: readingsFor(st), idempotencyKey: key() }, { checker: c.checker });
        if (r.blocked) throw new Error(`${st.name}: ${r.blockers.map((b) => b.message).join(" ")}`);
      }
    }
  };
  /** Finish: every expected piece good, two kept as samples (the default), packaging balanced. */
  const finish = async (batchId: string, perBox: number) => {
    const v = await prod.getFinishView(c.operator, batchId);
    const good = new Decimal(v.expectedUnits ?? "0");
    const packaging = v.packaging.map((p) => {
      const taken = new Decimal(p.taken);
      const used = p.materialId === M.box ? Decimal.min(taken, good.div(perBox).ceil()) : Decimal.min(taken, good);
      return { materialId: p.materialId, used: used.toString(), damaged: "0", leftOver: taken.minus(used).toString() };
    });
    return prod.finishBatch(c.operator, { batchId, goodUnits: good.toString(), packaging, idempotencyKey: key() }, { checker: c.checker });
  };
  const passQa = async (batchId: string) => {
    const [ins] = await db.select().from(s.inspections).where(eq(s.inspections.batchId, batchId));
    if (ins) {
      const v = await quality.getInspection(c.qa, ins.id);
      for (const t of v.tests) {
        if (t.valueKind === "numeric") {
          const lo = t.specMin !== null ? new Decimal(t.specMin) : null;
          const hi = t.specMax !== null ? new Decimal(t.specMax) : null;
          await quality.recordInspectionResult(c.qa, { inspectionId: ins.id, planTestId: t.id, value: (lo && hi ? lo.plus(hi).div(2) : (lo ?? hi ?? new Decimal(1))).toString(), uom: t.uom });
        } else await quality.recordInspectionResult(c.qa, { inspectionId: ins.id, planTestId: t.id, value: "Conforms", conforms: true });
      }
    }
    return quality.decideQualityCheck(c.qa, { batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
  };

  // 1. Acapulco Soap order 1: made and passed by QA (the release moves the boxes to the finished goods bay).
  const soap1 = await newOrder(soap.id);
  await work(soap1.batchId, { boxPieces: 118 });
  const soapDone = await finish(soap1.batchId, 24);
  await passQa(soap1.batchId);
  notes.push(`soap ${soapDone.lotNumber}: released by QA; its ${soapDone.boxes.length} boxes moved to the finished goods bay with the release`);
  // 2. Aloe Hand Lotion order 1: made, waiting for the QA check.
  const lotion1 = await newOrder(lotion.id);
  await work(lotion1.batchId);
  const lotionDone = await finish(lotion1.batchId, 24);
  notes.push(`lotion ${lotionDone.lotNumber}: waiting for the QA check`);
  // 3. Acapulco Soap order 2: in progress, weighing and "Heat and mix" done.
  const soap2 = await newOrder(soap.id);
  await work(soap2.batchId, { stopBefore: "Pour into moulds" });
  // 4. Aloe Hand Lotion order 2: approved, ready for Get materials.
  await newOrder(lotion.id);
  // Equipment ready for the next batch: a cleaning record after the last use (the scale was used by order 3),
  // calibration due in 60 days (setup), so "Get materials" → weighing of order 4 works at once.
  await cleanAll();
  notes.push("production orders at four steps");

  /* ---------------------------------------------------------------- purchasing */
  const proc = await import("../../modules/procurement");
  const sentPo = async (supplier: string, lines: { materialId: string; qty: string; uom: string; unitAmount: string }[]) => {
    const po = await proc.createPurchaseOrder(c.procurement, { supplierId: A.suppliers[supplier], lines, idempotencyKey: key() });
    await proc.submitPurchaseOrder(c.procurement, { purchaseOrderId: po.purchaseOrderId });
    for (const who of [c.manager, c.owner]) {
      const d = await proc.decidePurchaseOrder(who, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
      if (d.final) break;
    }
    await proc.sendPurchaseOrder(c.procurement, { purchaseOrderId: po.purchaseOrderId, email: false, idempotencyKey: key() });
    return po.purchaseOrderId;
  };
  await sentPo("Manila Print & Pack", [
    { materialId: M.wrapper, qty: "2000", uom: "pcs", unitAmount: "2.50" },
    { materialId: M.bottle, qty: "500", uom: "pcs", unitAmount: "9.00" },
  ]);
  const poOil = await sentPo("Laguna Oleo Supply", [
    { materialId: M.coconut, qty: "25", uom: "kg", unitAmount: "185.00" },
    { materialId: M.glycerin, qty: "10", uom: "kg", unitAmount: "95.00" },
  ]);
  const poLines = await db.select().from(s.purchaseOrderLines).where(eq(s.purchaseOrderLines.purchaseOrderId, poOil));
  const pl = (m: string) => poLines.find((x) => x.materialId === m)!;
  const delivery = await proc.receiveAgainstPurchaseOrder(c.warehouse, {
    purchaseOrderId: poOil,
    supplierDocumentNumber: "LOS-DR-1044",
    idempotencyKey: key(),
    intent: "post",
    lines: [
      { purchaseOrderLineId: pl(M.coconut).id, materialId: M.coconut, qty: "25", uom: "kg", supplierLotNumber: "LOS-25013", expiresOn: manilaDay(700), locationId: A.places["QUA-01"], storageConditionsConfirmed: true },
      { purchaseOrderLineId: pl(M.glycerin).id, materialId: M.glycerin, qty: "10", uom: "kg", supplierLotNumber: "LOS-GLY-102", expiresOn: manilaDay(720), locationId: A.places["QUA-01"], storageConditionsConfirmed: true },
    ],
  });
  const newCoconut = await lotOfLine(delivery.receiptId, "LOS-25013");
  await quality.decideLot(c.qa, { lotId: newCoconut.id, decision: "release", reason: "Certificate checked; looks and smells right (demo)." });
  notes.push("2 purchase orders: one sent, one delivered (coconut oil waiting to be put away, glycerin waiting for QA)");

  /* ---------------------------------------------------------------- customer orders */
  const sales = await import("../../modules/sales");
  const order = async (customer: string, productId: string, qty: string, price: string, inDays: number, po: string) => {
    const o = await sales.createOrder(c.sales, { customerId: A.customers[customer], customerPoNumber: po, requestedDeliveryOn: manilaDay(inDays), lines: [{ productId, qtyUnits: qty, unitPrice: price }], idempotencyKey: key() });
    await sales.submitOrder(c.sales, o.id, { idempotencyKey: key() });
    return o.id;
  };
  const soapOrder = await order("Luntian Wellness Stores", soap.id, "48", "70.00", 3, "LWS-PO-4502");
  await sales.allocateOrder(c.warehouse, soapOrder);
  await order("Isla Spa Supplies", lotion.id, "48", "185.00", 7, "ISS-2240");
  notes.push("2 customer orders: soap ready to get from the shelf, lotion waiting for released stock");

  // Completeness marker read by `pnpm db:demo auto` (src/db/demo.ts): written last, with the profile and version.
  await db.insert(s.auditEvents).values({ organizationId: A.orgId, actorLabel: "system:demo.seed", action: "platform.demo.seeded", entityType: "organization", entityId: A.orgId, entityNumber: LITE_ORG_NAME, after: { fictional: true, profile: "lite", seedVersion: DEMO_SEED_VERSION } });
  return notes;
}

/* ==================================================================== Part A: setup */

async function setup(dbx: Db) {
  const [org] = await db.insert(s.organizations).values({ name: LITE_ORG_NAME }).returning();
  const O = org.id;
  const [nfd] = await db.insert(s.sites).values({ organizationId: O, code: "NFD", name: "North Fields Plant", city: "Calamba (fictional)", province: "Laguna", country: "PH" }).returning();
  const [wh] = await db.insert(s.warehouses).values({ siteId: nfd.id, code: "WH1", name: "Main warehouse", warehouseKind: "general" }).returning();
  const places: Record<string, string> = {};
  for (const [code, name, kind, section, role] of PLACES) {
    const [l] = await db.insert(s.locations).values({ siteId: nfd.id, warehouseId: wh.id, code, name, kind, section }).returning();
    places[code] = l.id;
    if (role) await db.insert(s.warehouseSpecialLocations).values({ organizationId: O, siteId: nfd.id, warehouseId: wh.id, role, locationId: l.id });
  }

  const roleIds: Record<string, string> = {};
  for (const [code, b] of Object.entries(ROLE_BUNDLES)) {
    const [r] = await db.insert(s.roles).values({ organizationId: O, code, name: b.name, allowsOrganizationWide: b.orgWide, isSystem: true }).returning();
    roleIds[code] = r.id;
    await db.insert(s.rolePermissions).values([...new Set(b.permissions)].map((p) => ({ roleId: r.id, permissionCode: p })));
  }
  const pw = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db.insert(s.users).values({ organizationId: O, email: "system@bryels-care.invalid", displayName: "System (scheduled jobs)", passwordHash: "!", status: "system" });
  const U: Record<string, string> = {};
  for (const [email, displayName, role, orgWide] of LITE_PEOPLE) {
    const [u] = await db.insert(s.users).values({ organizationId: O, email, displayName, passwordHash: pw }).returning();
    U[email] = u.id;
    await db.insert(s.userSiteAssignments).values(orgWide ? { userId: u.id, roleId: roleIds[role], isOrganizationWide: true } : { userId: u.id, roleId: roleIds[role], siteId: nfd.id });
  }

  await installReferenceData(dbx, O);
  await db.insert(s.approvalRules).values(DEFAULT_APPROVAL_RULES.map((r) => ({ ...r, organizationId: O, effectiveFrom: "2026-01-01" })));
  await db.insert(s.allocationRules).values({ organizationId: O, scope: "default", strategy: "fefo", note: "Use first what expires first (A-PRD-16); QA and production to confirm." });

  // Approved print layouts: labels (material, WIP, finished goods, product, location, carton with "Made"), BMR, sheets, pick list, DR, PO.
  await seedW1e(dbx);
  await seedW2d(dbx);
  await seedW3e(dbx);
  const approvedAt = new Date(Date.now() - 10 * DAY);
  for (const [code, name, kind, renderer] of [
    ["DISP-SHEET", "Dispensing sheet (A4 landscape)", "dispensing_sheet", dispensingSheetRendererV1],
    ["TRAVELER", "Batch traveler (A4)", "traveler", travelerRendererV1],
    ["PO-STD", "Purchase order (A4, supplier copy)", "purchase_order", purchaseOrderRendererV1],
  ] as const) {
    const definition = renderer.defaultDefinition(kind);
    const [t] = await db.insert(s.documentTemplates).values({ organizationId: O, code, name, templateKind: kind, pageSize: definition.page.size, orientation: definition.page.orientation, createdBy: U["admin@bryels-care.test"], createdAt: approvedAt }).returning();
    await db.insert(s.documentTemplateVersions).values({ documentTemplateId: t.id, versionNo: 1, status: "approved", definition, definitionChecksum: definitionChecksum(definition), changeNote: "First version (demo)", createdBy: U["admin@bryels-care.test"], createdAt: approvedAt, submittedBy: U["manager.nfd@bryels-care.test"], submittedAt: approvedAt, approvedBy: U["qa.nfd@bryels-care.test"], approvedAt, effectiveFrom: approvedAt });
  }

  // Equipment: a calibrated scale, the soap mixer and the lotion filler, all clean.
  for (const [code, name, kind, cal] of [
    ["SC-01", "Platform scale 30 kg", "scale", true],
    ["MIX-01", "Soap and lotion mixer 50 L", "mixer", true],
    ["FIL-01", "Bottle filler", "filler", false],
  ] as const) {
    const [e] = await db
      .insert(s.equipment)
      .values({
        organizationId: O,
        siteId: nfd.id,
        code,
        name,
        equipmentKind: kind,
        lineLabel: kind === "scale" ? "Weighing room" : "Making room",
        status: "in_service",
        calibrationIntervalDays: cal ? 90 : null,
        calibrationDueDate: cal ? manilaDay(60) : null,
        lastCalibratedDate: cal ? manilaDay(-30) : null,
        cleaningStatus: "clean",
        lastCleanedAt: new Date(Date.now() - DAY),
        responsibleUserId: U["manager.nfd@bryels-care.test"],
        statusChangedBy: U["manager.nfd@bryels-care.test"],
        statusChangedAt: new Date(Date.now() - 30 * DAY),
        createdBy: U["manager.nfd@bryels-care.test"],
      })
      .returning();
    await db.insert(s.equipmentStateTransitions).values({ organizationId: O, siteId: nfd.id, equipmentId: e.id, fromState: null, toState: "in_service", actorId: U["manager.nfd@bryels-care.test"], reason: "Registered" });
  }

  // Suppliers (fictional) and customers (fictional).
  const suppliers: Record<string, string> = {};
  for (const [code, name, contactName, phone, city, lead] of [
    ["SUP-0001", "Laguna Oleo Supply", "Ramon Dizon", "+63 917 555 0201", "Calamba, Laguna", 7],
    ["SUP-0002", "Laguna Botanicals", "Liza Ocampo", "+63 917 555 0277", "Los Baños, Laguna", 10],
    ["SUP-0003", "Manila Print & Pack", "Joel Santos", "+63 918 555 0288", "Valenzuela, Metro Manila", 5],
  ] as const) {
    const [sp] = await db
      .insert(s.suppliers)
      .values({ organizationId: O, code, name, contactName, phone, email: `orders@${code.toLowerCase()}.test`, city, country: "Philippines", paymentTermsDays: 30, defaultLeadTimeDays: lead, qualityStatus: "approved", createdBy: U["admin@bryels-care.test"], updatedBy: U["admin@bryels-care.test"] })
      .returning();
    suppliers[name] = sp.id;
  }
  const customers: Record<string, string> = {};
  for (const [code, name, contactName, phone, email, address, minShelf] of [
    ["CUS-001", "Luntian Wellness Stores", "Bea Ramos", "+63 917 555 0101", "orders@luntian.test", "12 Mabini St., Quezon City, Metro Manila", 365],
    ["CUS-002", "Isla Spa Supplies", "Marco Tan", "+63 918 555 0144", "buying@islaspa.test", "88 Osmeña Blvd., Cebu City", 180],
  ] as const) {
    const [cu] = await db.insert(s.customers).values({ organizationId: O, code, name, contactName, phone, email, shipToAddress: address, minShelfLifeDays: minShelf }).returning();
    customers[name] = cu.id;
  }

  const ctx = async (email: string) => (await buildContextForUser(U[email], nfd.id))!;
  const c: Ctxs = {
    owner: await ctx("owner@bryels-care.test"),
    manager: await ctx("manager.nfd@bryels-care.test"),
    planner: await ctx("planner.nfd@bryels-care.test"),
    operator: await ctx("operator.nfd@bryels-care.test"),
    checker: await ctx("checker.nfd@bryels-care.test"),
    warehouse: await ctx("warehouse.nfd@bryels-care.test"),
    qa: await ctx("qa.nfd@bryels-care.test"),
    qaLead: await ctx("qa.lead@bryels-care.test"),
    procurement: await ctx("procurement@bryels-care.test"),
    sales: await ctx("sales@bryels-care.test"),
  };
  return { orgId: O, siteId: nfd.id, places, users: U, suppliers, customers, ctx: c };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Finished-product check plans: placeholder specifications for QA to confirm (A-PRD-18), approved by the second QA person. */
async function addCheckPlans(A: Setup, soapId: string, lotionId: string) {
  const U = A.users;
  const plans: [string, string, string, { testCode: string; name: string; method: string; valueKind: string; uom?: string; specMin?: string; specMax?: string; specText?: string }[]][] = [
    ["IP-SOAP-FP", "Acapulco Soap finished product check", soapId, [
      { testCode: "PH", name: "pH (10% solution)", method: "Placeholder method; QA to define", valueKind: "numeric", uom: "pH", specMin: "9.0", specMax: "10.5" },
      { testCode: "APPEAR", name: "Looks right", method: "Visual", valueKind: "text", specText: "Example only: smooth green bar, no cracks (QA to confirm)" },
    ]],
    ["IP-LOTION-FP", "Aloe Hand Lotion finished product check", lotionId, [
      { testCode: "PH", name: "pH", method: "Placeholder method; QA to define", valueKind: "numeric", uom: "pH", specMin: "5.0", specMax: "6.5" },
      { testCode: "APPEAR", name: "Looks right", method: "Visual", valueKind: "text", specText: "Example only: smooth white lotion, no lumps (QA to confirm)" },
    ]],
  ];
  for (const [code, name, productId, tests] of plans) {
    const [plan] = await db
      .insert(s.inspectionPlans)
      .values({ organizationId: A.orgId, code, name, planKind: "finished_product", productId, samplingInstructions: "Example sampling plan for the demo only. QA must set the sample size and frequency before production use.", isPlaceholder: true, revisionNo: 1, status: "draft", changeSummary: "First revision (fictional demo specification)", createdBy: U["qa.nfd@bryels-care.test"] })
      .returning();
    await db.insert(s.inspectionPlanTests).values(tests.map((t, i) => ({ inspectionPlanId: plan.id, sequence: i + 1, testCode: t.testCode, name: t.name, method: t.method, valueKind: t.valueKind, uom: t.uom ?? null, specMin: t.specMin ?? null, specMax: t.specMax ?? null, specText: t.specText ?? null })));
    await db.update(s.inspectionPlans).set({ status: "approved", effectiveFrom: manilaDay(-30), submittedBy: U["qa.nfd@bryels-care.test"], submittedAt: new Date(), approvedBy: U["qa.lead@bryels-care.test"], approvedAt: new Date() }).where(eq(s.inspectionPlans.id, plan.id));
    await db.insert(s.approvalDecisions).values({ organizationId: A.orgId, recordType: "inspection_plan", recordId: plan.id, step: 1, decision: "approved", decidedBy: U["qa.lead@bryels-care.test"], note: "Demo approval of a placeholder specification" });
  }
}

/** The approved-supplier list through the services: procurement proposes, QA approves. */
async function approvedSupplierList(A: Setup, M: Record<string, string>) {
  const proc = await import("../../modules/procurement");
  const pairs: [string, string[]][] = [
    ["Laguna Oleo Supply", [M.coconut, M.palm, M.lye, M.glycerin, M.cetearyl]],
    ["Laguna Botanicals", [M.extract, M.green, M.aloe, M.water]],
    ["Manila Print & Pack", [M.wrapper, M.bottle, M.cap, M.box]],
  ];
  for (const [supplier, mats] of pairs) {
    for (const materialId of mats) {
      const p = await proc.proposeSupplierMaterial(A.ctx.procurement, { supplierId: A.suppliers[supplier], materialId, note: "Supplier questionnaire and certificate on file (fictional demo record)." });
      await proc.decideAslChange(A.ctx.qa, { changeId: p.changeId, decision: "approved", note: "Approved on the evidence on file (demo)." });
    }
  }
}
