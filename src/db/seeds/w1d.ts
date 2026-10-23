/**
 * Wave 1 W1D demo seed: production engineering master data. Fictional data only.
 *
 * Every formula quantity, tolerance, step parameter and inspection specification below is a
 * clearly fictional placeholder for demos and tests. Verify with authorized personnel before
 * production use (A-PRD-18, A-PROC-03, A-PROC-20).
 *
 * Rows are written draft-first (children inserted while the parent is draft, then the parent is
 * moved to its final status) so the seed also works when the draft-only triggers of
 * src/db/sql/w1d.sql are installed.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;
type Users = Record<string, string>;

const at = (offsetDays: number, hour = 9) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  d.setUTCHours(hour - 8, 0, 0, 0);
  return d;
};
const manilaDay = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
};

/** Effective date of the seeded approved revisions (half a year ago). */
export const SEED_EFFECTIVE_FROM_OFFSET = -180;

export type SeedStep = {
  name: string;
  kind: string;
  area?: string;
  instruction: string;
  equipmentKind?: string;
  wi?: string;
  checklist?: string[];
  parameters?: { code: string; name: string; valueKind: "numeric" | "text" | "boolean"; uom?: string }[];
};

const CLEARANCE_ITEMS = [
  "Materials, labels and documents of the previous batch removed",
  "Work surfaces and equipment visibly clean",
  "Status labels show this batch only",
];

export const SOAP_ROUTING: SeedStep[] = [
  { name: "Weighing area line clearance", kind: "line_clearance", area: "weighing", instruction: "Confirm the weighing area is clean and free of previous materials, labels and documents.", checklist: CLEARANCE_ITEMS },
  { name: "Weighing", kind: "dispensing", instruction: "Dispense each ingredient against the formula; operator weighs, a second person checks.", equipmentKind: "scale" },
  { name: "Production area line clearance", kind: "line_clearance", area: "production", instruction: "Confirm the production room and equipment are clean and labelled for this batch.", checklist: CLEARANCE_ITEMS },
  {
    name: "Mixing and cutting",
    kind: "process",
    instruction: "Combine oils and lye solution, mix to trace, add extract and colour, pour, cure and cut. Record temperature and time.",
    equipmentKind: "mixer",
    wi: "WI-SOAP-MIX",
    parameters: [
      { code: "oil_temp", name: "Oil phase temperature at mixing", valueKind: "numeric", uom: "°C" },
      { code: "trace_time", name: "Time to trace", valueKind: "numeric", uom: "min" },
      { code: "mould_id", name: "Mould used", valueKind: "text" },
    ],
  },
  { name: "Packaging area line clearance", kind: "line_clearance", area: "packaging", instruction: "Confirm the packaging line is clear before wrapping (second clearance on the paper BMR).", checklist: CLEARANCE_ITEMS },
  {
    name: "Packaging and labeling",
    kind: "packaging",
    instruction: "Wrap bars, print lot and expiry, reconcile wrappers used and destroyed.",
    parameters: [
      { code: "wrappers_used", name: "Wrappers used", valueKind: "numeric", uom: "pcs" },
      { code: "wrappers_destroyed", name: "Wrappers destroyed", valueKind: "numeric", uom: "pcs" },
    ],
  },
  { name: "Transfer to quarantine storage area", kind: "transfer", instruction: "Move finished goods to quarantine until QA disposition." },
];

export const LOTION_ROUTING: SeedStep[] = [
  { name: "Weighing area line clearance", kind: "line_clearance", area: "weighing", instruction: "Confirm the weighing area is clean.", checklist: CLEARANCE_ITEMS },
  { name: "Weighing", kind: "dispensing", instruction: "Dispense each phase ingredient; operator weighs, a second person checks.", equipmentKind: "scale" },
  { name: "Production area line clearance", kind: "line_clearance", area: "production", instruction: "Confirm the kettle and filler are clean.", checklist: CLEARANCE_ITEMS },
  {
    name: "Heating and emulsification",
    kind: "process",
    instruction: "Heat water and oil phases separately, combine and homogenise. Record temperatures.",
    parameters: [
      { code: "water_phase_temp", name: "Water phase temperature", valueKind: "numeric", uom: "°C" },
      { code: "oil_phase_temp", name: "Oil phase temperature", valueKind: "numeric", uom: "°C" },
    ],
  },
  { name: "Cooling and in-process check", kind: "in_process_qc", instruction: "Cool, add aloe below the set temperature, check appearance and pH.", parameters: [{ code: "appearance_ok", name: "Appearance conforms", valueKind: "boolean" }] },
  { name: "Filling and labeling", kind: "filling", instruction: "Fill bottles, cap, label with lot and expiry." },
  { name: "Transfer to quarantine storage area", kind: "transfer", instruction: "Move finished goods to quarantine until QA disposition." },
];

/* ------------------------------------------------------------------ work instructions */

const wiCache = new Map<string, Map<string, string>>();

/** Approved work-instruction revisions shared by the seeded routings (created once per organization). */
async function ensureWorkInstructions(db: Db, O: string, U: Users) {
  const cached = wiCache.get(O);
  if (cached) return cached;
  const out = new Map<string, string>();
  const defs: [string, string, string][] = [
    [
      "WI-SOAP-MIX",
      "Soap mixing, pouring and cutting (demo)",
      "DEMO INSTRUCTION, NOT AN APPROVED SOP. Verify with authorized personnel before production use.\n\n1. Wear gloves, goggles and apron before handling lye solution.\n2. Add the lye solution to the oils slowly while mixing.\n3. Mix to trace; record the oil temperature and time to trace.\n4. Add extract and colour, mix until uniform.\n5. Pour into the mould, record the mould id, then cure and cut as the process owner specifies.",
    ],
  ];
  for (const [code, name, body] of defs) {
    const [wi] = await db.insert(s.workInstructions).values({ organizationId: O, code, name, createdBy: U["manager.nfd"], createdAt: at(-200) }).returning();
    const [rev] = await db
      .insert(s.workInstructionRevisions)
      .values({ workInstructionId: wi.id, revisionNo: 1, status: "draft", bodyMarkdown: body, changeSummary: "First revision (demo)", createdBy: U["manager.nfd"], createdAt: at(-200) })
      .returning();
    await db
      .update(s.workInstructionRevisions)
      .set({ status: "approved", effectiveFrom: manilaDay(SEED_EFFECTIVE_FROM_OFFSET), submittedBy: U["manager.nfd"], submittedAt: at(-195), approvedBy: U["qa.nfd"], approvedAt: at(-190) })
      .where(eq(s.workInstructionRevisions.id, rev.id));
    await db.insert(s.approvalDecisions).values({ organizationId: O, recordType: "work_instruction_revision", recordId: rev.id, step: 1, decision: "approved", decidedBy: U["qa.nfd"], decidedAt: at(-190), note: "Demo approval" });
    out.set(code, rev.id);
  }
  wiCache.set(O, out);
  return out;
}

/* ------------------------------------------------------------------ formula + routing */

async function approvals(db: Db, O: string, recordType: string, recordId: string, U: Users, daysAgo: number) {
  await db.insert(s.approvalDecisions).values([
    { organizationId: O, recordType, recordId, step: 1, decision: "approved", decidedBy: U["qa.nfd"], decidedAt: at(-daysAgo, 10), note: "Demo QA approval (fictional values)" },
    { organizationId: O, recordType, recordId, step: 2, decision: "approved", decidedBy: U["owner"], decidedAt: at(-daysAgo, 15), note: "Demo final approval" },
  ]);
}

async function insertRoutingSteps(db: Db, routingRevisionId: string, steps: SeedStep[], wis: Map<string, string>) {
  const rows = [];
  for (const [i, st] of steps.entries()) {
    const [row] = await db
      .insert(s.routingSteps)
      .values({
        routingRevisionId,
        stepNo: i + 1,
        name: st.name,
        stepKind: st.kind,
        area: st.area ?? null,
        instruction: st.instruction,
        workInstructionRevisionId: st.wi ? (wis.get(st.wi) ?? null) : null,
        requiresChecker: true,
        requiresEquipment: !!st.equipmentKind,
        equipmentKind: st.equipmentKind ?? null,
      })
      .returning();
    if (st.checklist?.length) await db.insert(s.routingStepChecklistItems).values(st.checklist.map((text, j) => ({ routingStepId: row.id, itemNo: j + 1, text })));
    if (st.parameters?.length) {
      await db.insert(s.routingStepParameters).values(st.parameters.map((p, j) => ({ routingStepId: row.id, sequence: j + 1, code: p.code, name: p.name, valueKind: p.valueKind, uom: p.uom ?? null, isRequired: p.valueKind !== "text" })));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Creates a formula with an approved revision 1 (two approvals) and the product's routing with an
 * approved revision 1, both effective from SEED_EFFECTIVE_FROM_OFFSET days ago. Used by
 * src/db/seed.ts for the three demo products.
 */
export async function seedApprovedFormulaAndRouting(
  db: Db,
  args: {
    O: string;
    U: Users;
    product: { id: string; skuCode: string };
    code: string;
    name: string;
    sizeG: string;
    yieldPct: string;
    lines: { materialId: string; quantityG: string; tolerancePct: string; phaseCode?: string }[];
    routingCode: string;
    steps: SeedStep[];
  },
) {
  const { O, U } = args;
  const wis = await ensureWorkInstructions(db, O, U);
  const effectiveFrom = manilaDay(SEED_EFFECTIVE_FROM_OFFSET);
  const [formula] = await db.insert(s.formulas).values({ organizationId: O, productId: args.product.id, code: args.code, name: args.name }).returning();
  const [draft] = await db
    .insert(s.formulaRevisions)
    .values({
      formulaId: formula.id,
      revisionNo: 1,
      status: "draft",
      referenceBatchSizeG: args.sizeG,
      theoreticalYieldPct: args.yieldPct,
      changeSummary: "First revision (demo)",
      notes: "Demo values. Verify formula, tolerances and steps with authorized personnel before production use.",
      createdBy: U["manager.nfd"],
      createdAt: at(-200),
    })
    .returning();
  const bomLines = await db
    .insert(s.bomLines)
    .values(args.lines.map((l, i) => ({ formulaRevisionId: draft.id, lineNo: i + 1, materialId: l.materialId, quantityG: l.quantityG, tolerancePct: l.tolerancePct, phaseCode: l.phaseCode ?? null })))
    .returning();
  const [rev] = await db
    .update(s.formulaRevisions)
    .set({ status: "approved", effectiveFrom, submittedBy: U["manager.nfd"], submittedAt: at(-195), approvedBy: U["owner"], approvedAt: at(-190, 15) })
    .where(eq(s.formulaRevisions.id, draft.id))
    .returning();
  await approvals(db, O, "formula_revision", rev.id, U, 190);

  const [routing] = await db.insert(s.routings).values({ organizationId: O, productId: args.product.id, code: args.routingCode, name: `${args.name} routing`, createdBy: U["manager.nfd"], createdAt: at(-200) }).returning();
  const [rdraft] = await db
    .insert(s.routingRevisions)
    .values({ routingId: routing.id, revisionNo: 1, status: "draft", changeSummary: "First revision (demo, from the paper BMR checklist)", createdBy: U["manager.nfd"], createdAt: at(-200) })
    .returning();
  const steps = await insertRoutingSteps(db, rdraft.id, args.steps, wis);
  const [routingRev] = await db
    .update(s.routingRevisions)
    .set({ status: "approved", effectiveFrom, changeScope: "quality_relevant", submittedBy: U["manager.nfd"], submittedAt: at(-195), approvedBy: U["owner"], approvedAt: at(-190, 15) })
    .where(eq(s.routingRevisions.id, rdraft.id))
    .returning();
  await approvals(db, O, "routing_revision", routingRev.id, U, 190);
  return { formula, rev, bomLines, routing, routingRev, steps };
}

/* ------------------------------------------------------------------ the rest */

/**
 * Planner and second QA user, a formula revision awaiting approval, inspection plans
 * (placeholders flagged for QA review) and the equipment register with one item out of service.
 * Called once near the end of src/db/seed.ts main().
 */
export async function seedW1D(db: Db, ctx: { O: string; U: Users; sites: Record<string, string>; roleRows: Record<string, string>; passwordHash: string }) {
  const { O, U, sites, roleRows } = ctx;
  const NFD = sites.NFD;
  const RVS = sites.RVS;

  // People
  const people: [string, string, string, string[]][] = [
    ["planner.nfd@bryels-care.test", "Cora Villamor", "production_planner", [NFD]],
    ["qa.lead@bryels-care.test", "Teresa Ocampo", "qa_qc", [NFD, RVS]],
  ];
  for (const [email, displayName, role, scope] of people) {
    const [u] = await db.insert(s.users).values({ organizationId: O, email, displayName, passwordHash: ctx.passwordHash }).returning();
    U[email.split("@")[0]] = u.id;
    for (const siteId of scope) await db.insert(s.userSiteAssignments).values({ userId: u.id, roleId: roleRows[role], siteId });
  }

  // Guava Bar Soap: revision 2 submitted by the planner, awaiting QA and manager approval.
  const [gbs] = await db.select().from(s.formulas).where(and(eq(s.formulas.organizationId, O), eq(s.formulas.code, "F-GBS-01")));
  if (gbs) {
    const [rev1] = await db.select().from(s.formulaRevisions).where(and(eq(s.formulaRevisions.formulaId, gbs.id), eq(s.formulaRevisions.revisionNo, 1)));
    const lines = await db.select().from(s.bomLines).where(eq(s.bomLines.formulaRevisionId, rev1.id));
    const [rev2] = await db
      .insert(s.formulaRevisions)
      .values({
        formulaId: gbs.id,
        revisionNo: 2,
        status: "draft",
        referenceBatchSizeG: rev1.referenceBatchSizeG,
        theoreticalYieldPct: rev1.theoreticalYieldPct,
        supersedesId: rev1.id,
        effectiveFrom: manilaDay(14),
        changeSummary: "Demo change: guava leaf extract 225.2 g → 230.0 g and an absolute tolerance on the extract line (fictional values).",
        notes: rev1.notes,
        createdBy: U["planner.nfd"],
        createdAt: at(-2, 10),
      })
      .returning();
    await db.insert(s.bomLines).values(
      lines.map(({ id: _i, formulaRevisionId: _f, ...l }) => {
        const isExtract = l.quantityG.startsWith("225.2");
        return { ...l, formulaRevisionId: rev2.id, quantityG: isExtract ? "230.0" : l.quantityG, tolerancePct: isExtract ? null : l.tolerancePct, toleranceAbsG: isExtract ? "1.5" : null };
      }),
    );
    await db.update(s.formulaRevisions).set({ status: "pending_approval", submittedBy: U["planner.nfd"], submittedAt: at(-1, 11) }).where(eq(s.formulaRevisions.id, rev2.id));
  }

  // Inspection plans: fictional placeholders, approved by a second QA user.
  const products = await db.select().from(s.products).where(eq(s.products.organizationId, O));
  const P = (sku: string) => products.find((p) => p.skuCode === sku)!;
  const [coconut] = await db.select().from(s.materials).where(and(eq(s.materials.organizationId, O), eq(s.materials.code, "MAT-0012")));
  type T = { testCode: string; name: string; method?: string; valueKind: string; uom?: string; specMin?: string; specMax?: string; specText?: string };
  const soapTests: T[] = [
    { testCode: "PH", name: "pH (10% solution)", method: "Placeholder method; QA to define", valueKind: "numeric", uom: "pH", specMin: "9.0", specMax: "10.5" },
    { testCode: "APPEAR", name: "Appearance", method: "Visual", valueKind: "text", specText: "PLACEHOLDER: smooth bar, no cracks (QA to confirm)" },
    { testCode: "NETWT", name: "Net weight (n=10)", method: "Balance", valueKind: "numeric", uom: "g", specMin: "135" },
  ];
  const planDefs: { code: string; name: string; kind: string; productId?: string; materialId?: string; tests: T[] }[] = [
    { code: "IP-ACS-FP", name: "Acapulco Soap finished product (PLACEHOLDER)", kind: "finished_product", productId: P("ACS-135").id, tests: soapTests },
    { code: "IP-GBS-FP", name: "Guava Bar Soap finished product (PLACEHOLDER)", kind: "finished_product", productId: P("GBS-135").id, tests: soapTests },
    {
      code: "IP-MAT-0012-IN",
      name: "Coconut oil incoming inspection (PLACEHOLDER)",
      kind: "incoming",
      materialId: coconut.id,
      tests: [
        { testCode: "COA", name: "Certificate of analysis present and matches the lot", valueKind: "pass_fail", specText: "CoA present, supplier lot matches" },
        { testCode: "APPEAR", name: "Appearance and odour", method: "Visual / olfactory", valueKind: "text", specText: "PLACEHOLDER: conforms to supplier specification (QA to confirm)" },
      ],
    },
  ];
  for (const d of planDefs) {
    const [plan] = await db
      .insert(s.inspectionPlans)
      .values({
        organizationId: O,
        code: d.code,
        name: d.name,
        planKind: d.kind,
        productId: d.productId ?? null,
        materialId: d.materialId ?? null,
        samplingInstructions: "PLACEHOLDER sampling plan for the demo. QA must define sample size and frequency before production use.",
        isPlaceholder: true,
        revisionNo: 1,
        status: "draft",
        changeSummary: "First revision (fictional demo specification)",
        createdBy: U["qa.nfd"],
        createdAt: at(-170),
      })
      .returning();
    await db.insert(s.inspectionPlanTests).values(
      d.tests.map((t, i) => ({ inspectionPlanId: plan.id, sequence: i + 1, testCode: t.testCode, name: t.name, method: t.method ?? null, valueKind: t.valueKind, uom: t.uom ?? null, specMin: t.specMin ?? null, specMax: t.specMax ?? null, specText: t.specText ?? null })),
    );
    await db
      .update(s.inspectionPlans)
      .set({ status: "approved", effectiveFrom: manilaDay(SEED_EFFECTIVE_FROM_OFFSET + 10), submittedBy: U["qa.nfd"], submittedAt: at(-169), approvedBy: U["qa.lead"], approvedAt: at(-168) })
      .where(eq(s.inspectionPlans.id, plan.id));
    await db.insert(s.approvalDecisions).values({ organizationId: O, recordType: "inspection_plan", recordId: plan.id, step: 1, decision: "approved", decidedBy: U["qa.lead"], decidedAt: at(-168), note: "Demo approval of placeholder specification" });
  }

  // Equipment register (NFD): one scale overdue for calibration, one mixer out of service.
  type E = { code: string; name: string; kind: string; line: string; calDays?: number; calDue?: number; pmDays?: number; pmDue?: number; status?: string; capacity?: [string, string, string] };
  const eqDefs: E[] = [
    { code: "SC-01", name: "Platform scale 30 kg", kind: "scale", line: "Weighing room", calDays: 90, calDue: 20, capacity: ["0.1", "30000", "g"] },
    { code: "SC-02", name: "Bench scale 3 kg", kind: "scale", line: "Weighing room", calDays: 90, calDue: -3, capacity: ["0.01", "3000", "g"] },
    { code: "MIX-01", name: "Soap mixer 50 L", kind: "mixer", line: "Soap line 1", pmDays: 180, pmDue: 60 },
    { code: "MIX-02", name: "Backup soap mixer 25 L", kind: "mixer", line: "Soap line 1", pmDays: 180, pmDue: 40, status: "out_of_service" },
    { code: "MLD-01", name: "Soap mould line (12-bar frames)", kind: "mould", line: "Soap line 1", pmDays: 365, pmDue: 200 },
  ];
  for (const d of eqDefs) {
    const [e] = await db
      .insert(s.equipment)
      .values({
        organizationId: O,
        siteId: NFD,
        code: d.code,
        name: d.name,
        equipmentKind: d.kind,
        lineLabel: d.line,
        status: "in_service",
        calibrationIntervalDays: d.calDays ?? null,
        calibrationDueDate: d.calDue !== undefined ? manilaDay(d.calDue) : null,
        lastCalibratedDate: d.calDue !== undefined && d.calDays ? manilaDay(d.calDue - d.calDays) : null,
        maintenanceIntervalDays: d.pmDays ?? null,
        maintenanceDueDate: d.pmDue !== undefined ? manilaDay(d.pmDue) : null,
        lastMaintainedDate: d.pmDue !== undefined && d.pmDays ? manilaDay(d.pmDue - d.pmDays) : null,
        cleaningStatus: "clean",
        lastCleanedAt: at(-1, 17),
        capacityMin: d.capacity?.[0] ?? null,
        capacityMax: d.capacity?.[1] ?? null,
        capacityUom: d.capacity?.[2] ?? null,
        responsibleUserId: U["manager.nfd"],
        statusChangedBy: U["manager.nfd"],
        statusChangedAt: at(-150),
        createdBy: U["manager.nfd"],
        createdAt: at(-150),
      })
      .returning();
    await db.insert(s.equipmentStateTransitions).values({ organizationId: O, siteId: NFD, equipmentId: e.id, fromState: null, toState: "in_service", actorId: U["manager.nfd"], reason: "Registered", occurredAt: at(-150) });
    if (d.calDue !== undefined && d.calDays) {
      await db.insert(s.equipmentServiceRecords).values({
        organizationId: O,
        siteId: NFD,
        equipmentId: e.id,
        serviceKind: "calibration",
        performedAt: at(d.calDue - d.calDays, 10),
        performedByExternal: "Metro Calibration Services (fictional)",
        result: "pass",
        nextDueDate: manilaDay(d.calDue),
        referenceNumber: `CAL-${d.code}-001`,
        notes: "Demo calibration certificate reference",
        createdBy: U["manager.nfd"],
      });
    }
    await db.insert(s.equipmentServiceRecords).values({ organizationId: O, siteId: NFD, equipmentId: e.id, serviceKind: "cleaning", performedAt: at(-1, 17), performedBy: U["operator.nfd"], result: "completed", createdBy: U["operator.nfd"] });
    if (d.status === "out_of_service") {
      await db.update(s.equipment).set({ status: "out_of_service", statusChangedAt: at(-4, 14), statusChangedBy: U["manager.nfd"] }).where(eq(s.equipment.id, e.id));
      await db.insert(s.equipmentStateTransitions).values({ organizationId: O, siteId: NFD, equipmentId: e.id, fromState: "in_service", toState: "out_of_service", actorId: U["manager.nfd"], reason: "Gearbox noise; waiting for repair (demo)", occurredAt: at(-4, 14) });
      await db.insert(s.downtimeEvents).values({ organizationId: O, siteId: NFD, equipmentId: e.id, startedAt: at(-4, 14), reason: "Gearbox noise; waiting for repair (demo)", loggedBy: U["manager.nfd"] });
    }
  }
}
