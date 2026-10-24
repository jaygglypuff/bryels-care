import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { DomainError } from "@/lib/errors";

/**
 * BMR section sources owned by other Wave 2 streams (integration contract, docs/reports-and-templates.md
 * §2.2 and §1.4.2). Each function answers `{ available, rows }`:
 *
 * - `available: false` when the source table is not in this database yet (the stream that owns it
 *   has not merged). The BMR then prints "not captured electronically in this system version"
 *   for that section, which is different from "none recorded".
 * - `available: true` and the rows otherwise, read with the column names of docs/data-model.md.
 * - When the table exists but a contract column is missing, the function throws: a BMR must
 *   never silently omit recorded data. The integrator then aligns the query below with the
 *   merged schema (one place to change).
 *
 * All queries are scoped by batch id only; the caller (buildBmrDataset) has already checked the
 * batch's organization, site and the caller's permission.
 */

export type SourceResult<T> = { available: boolean; rows: T[] };

type Row = Record<string, unknown>;

async function tableColumns(q: DbOrTx, table: string): Promise<Set<string> | null> {
  const rows = (await q.execute(
    sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`,
  )) as unknown as { column_name: string }[];
  return rows.length ? new Set(rows.map((r) => r.column_name)) : null;
}

/** null = the tables are absent (not merged); throws on a partial match (contract drift). */
async function contract(q: DbOrTx, source: string, need: Record<string, string[]>): Promise<boolean> {
  for (const [table, cols] of Object.entries(need)) {
    const have = await tableColumns(q, table);
    if (!have) return false;
    const missing = cols.filter((c) => !have.has(c));
    if (missing.length) {
      throw new DomainError("setup_required", `The BMR source "${source}" does not match the ${table} table (missing ${missing.join(", ")}). See docs/reports-and-templates.md §1.4.2.`);
    }
  }
  return true;
}

async function run<T>(q: DbOrTx, source: string, need: Record<string, string[]>, query: SQL): Promise<SourceResult<T>> {
  if (!(await contract(q, source, need))) return { available: false, rows: [] };
  const rows = (await q.execute(query)) as unknown as T[];
  return { available: true, rows: [...rows] };
}

const ts = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export type LineClearanceRow = { stepNo: number; stepName: string; itemNo: number; text: string; answer: string; note: string | null; answeredBy: string | null; answeredAt: Date | null };
/** W2B: answers of routing checklist items per step record (`process_step_checklist_results`). */
export async function bmrLineClearanceChecks(q: DbOrTx, batchId: string): Promise<SourceResult<LineClearanceRow>> {
  const r = await run<Row>(
    q,
    "line clearance",
    { process_step_checklist_results: ["process_step_record_id", "item_no", "item_text", "answer", "note", "answered_by", "answered_at", "supersedes_id"] },
    // Item number and text come from the result row (snapshot at answering); a re-answered item prints its latest answer.
    sql`select psr.step_no, psr.name as step_name, c.item_no, c.item_text as text, c.answer, c.note, u.display_name as answered_by, c.answered_at
        from process_step_checklist_results c
        join process_step_records psr on psr.id = c.process_step_record_id
        left join users u on u.id = c.answered_by
        where psr.batch_id = ${batchId}
          and not exists (select 1 from process_step_checklist_results n where n.supersedes_id = c.id)
        order by psr.step_no, c.item_no`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({ stepNo: Number(x.step_no), stepName: String(x.step_name), itemNo: Number(x.item_no), text: String(x.text), answer: String(x.answer), note: (x.note as string) ?? null, answeredBy: (x.answered_by as string) ?? null, answeredAt: ts(x.answered_at) })),
  };
}

export type ReadingRow = { stepNo: number; parameter: string; uom: string | null; min: string | null; target: string | null; max: string | null; value: string; within: boolean | null; recordedBy: string | null; recordedAt: Date | null; superseded: boolean; correctionReason: string | null };
/** W2B: actual process parameters (`process_step_readings`); superseded readings are returned flagged (printed struck through). */
export async function bmrProcessReadings(q: DbOrTx, batchId: string): Promise<SourceResult<ReadingRow>> {
  const r = await run<Row>(
    q,
    "process parameters",
    {
      process_step_readings: ["process_step_record_id", "routing_step_parameter_id", "parameter_name", "uom", "min_value", "target_value", "max_value", "value_numeric", "value_text", "value_boolean", "is_within_limits", "recorded_at", "recorded_by", "supersedes_id", "correction_reason"],
    },
    // Name, unit and limits are the reading's snapshot of the routing parameter at recording time.
    sql`select psr.step_no, r.parameter_name as parameter, r.uom, r.min_value::text as min_value, r.target_value::text as target_value, r.max_value::text as max_value,
               coalesce(r.value_numeric::text, r.value_text, case when r.value_boolean is null then null when r.value_boolean then 'yes' else 'no' end) as value,
               r.is_within_limits, u.display_name as recorded_by, r.recorded_at,
               exists (select 1 from process_step_readings n where n.supersedes_id = r.id) as superseded,
               (select n.correction_reason from process_step_readings n where n.supersedes_id = r.id limit 1) as correction_reason
        from process_step_readings r
        join process_step_records psr on psr.id = r.process_step_record_id
        left join routing_step_parameters p on p.id = r.routing_step_parameter_id
        left join users u on u.id = r.recorded_by
        where psr.batch_id = ${batchId}
        order by psr.step_no, p.sequence nulls last, r.recorded_at`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      stepNo: Number(x.step_no),
      parameter: String(x.parameter),
      uom: (x.uom as string) ?? null,
      min: (x.min_value as string) ?? null,
      target: (x.target_value as string) ?? null,
      max: (x.max_value as string) ?? null,
      value: String(x.value ?? ""),
      within: x.is_within_limits === null || x.is_within_limits === undefined ? null : Boolean(x.is_within_limits),
      recordedBy: (x.recorded_by as string) ?? null,
      recordedAt: ts(x.recorded_at),
      superseded: Boolean(x.superseded),
      correctionReason: (x.correction_reason as string) ?? null,
    })),
  };
}

export type EquipmentUseRow = { stepNo: number | null; code: string; name: string; calibrationDue: string | null; cleaning: string | null; operator: string | null; startedAt: Date | null; endedAt: Date | null; exceptionReason: string | null };
/** W2B: equipment used on the batch (`equipment_uses`), with the evidence snapshot at use. */
export async function bmrEquipmentUses(q: DbOrTx, batchId: string): Promise<SourceResult<EquipmentUseRow>> {
  const r = await run<Row>(
    q,
    "equipment use",
    { equipment_uses: ["batch_id", "equipment_id", "process_step_record_id", "started_at", "operator_id", "cleaning_status_at_start", "calibration_due_date_at_use", "exception_reason"] },
    sql`select psr.step_no, e.code, e.name, eu.calibration_due_date_at_use::text as calibration_due, eu.cleaning_status_at_start as cleaning,
               u.display_name as operator, eu.started_at, eu.ended_at, eu.exception_reason
        from equipment_uses eu
        join equipment e on e.id = eu.equipment_id
        left join process_step_records psr on psr.id = eu.process_step_record_id
        left join users u on u.id = eu.operator_id
        where eu.batch_id = ${batchId}
        order by eu.started_at`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      stepNo: x.step_no === null || x.step_no === undefined ? null : Number(x.step_no),
      code: String(x.code),
      name: String(x.name),
      calibrationDue: (x.calibration_due as string) ?? null,
      cleaning: (x.cleaning as string) ?? null,
      operator: (x.operator as string) ?? null,
      startedAt: ts(x.started_at),
      endedAt: ts(x.ended_at),
      exceptionReason: (x.exception_reason as string) ?? null,
    })),
  };
}

export type YieldRecordRow = {
  theoretical: string;
  actual: string;
  actualUnits: string | null;
  variance: string;
  variancePct: string | null;
  yieldPct: string | null;
  limitsText: string | null;
  withinLimits: boolean | null;
  labelsIssued: number | null;
  labelsUsed: number | null;
  labelsDestroyed: number | null;
  packagingNotes: string | null;
  recordedBy: string | null;
  /** Second person on the yield: the checker who co-signed the transfer to quarantine (batch output line 1). */
  checkedBy: string | null;
  /** Approver of an out-of-limits yield (with its deviation), when there was one. */
  approvedBy: string | null;
  approvalReason: string | null;
  recordedAt: Date | null;
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** W2B: the current yield record (`yield_records.is_current`), with the transfer checker as the second signature. */
export async function bmrYieldRecord(q: DbOrTx, batchId: string): Promise<SourceResult<YieldRecordRow>> {
  const r = await run<Row>(
    q,
    "yield and packaging reconciliation",
    {
      yield_records: ["batch_id", "theoretical_base", "actual_base", "actual_units", "variance_base", "variance_pct", "yield_pct", "min_pct", "max_pct", "is_within_limits", "labels_issued", "labels_used", "labels_destroyed", "notes", "recorded_by", "recorded_at", "approved_by", "approval_reason", "is_current"],
      batch_outputs: ["batch_id", "line_no", "checked_by"],
    },
    sql`select y.theoretical_base::text as theoretical, y.actual_base::text as actual, y.actual_units::text as actual_units, y.variance_base::text as variance,
               y.variance_pct::text as variance_pct, y.yield_pct::text as yield_pct, y.min_pct::text as min_pct, y.max_pct::text as max_pct, y.is_within_limits,
               y.labels_issued, y.labels_used, y.labels_destroyed, y.notes,
               ru.display_name as recorded_by, cu.display_name as checked_by, au.display_name as approved_by, y.approval_reason, y.recorded_at
        from yield_records y
        left join users ru on ru.id = y.recorded_by
        left join users au on au.id = y.approved_by
        left join batch_outputs o on o.batch_id = y.batch_id and o.line_no = 1
        left join users cu on cu.id = o.checked_by
        where y.batch_id = ${batchId} and y.is_current
        order by y.recorded_at desc limit 1`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      theoretical: String(x.theoretical),
      actual: String(x.actual),
      actualUnits: str(x.actual_units),
      variance: String(x.variance),
      variancePct: str(x.variance_pct),
      yieldPct: str(x.yield_pct),
      limitsText: x.min_pct !== null && x.min_pct !== undefined && x.max_pct !== null && x.max_pct !== undefined ? `${Number(x.min_pct)}–${Number(x.max_pct)} %` : null,
      withinLimits: x.is_within_limits === null || x.is_within_limits === undefined ? null : Boolean(x.is_within_limits),
      labelsIssued: num(x.labels_issued),
      labelsUsed: num(x.labels_used),
      labelsDestroyed: num(x.labels_destroyed),
      packagingNotes: str(x.notes),
      recordedBy: str(x.recorded_by),
      checkedBy: str(x.checked_by),
      approvedBy: str(x.approved_by),
      approvalReason: str(x.approval_reason),
      recordedAt: ts(x.recorded_at),
    })),
  };
}

export type PackagingReconciliationRow = {
  material: string;
  lot: string | null;
  uom: string;
  issued: string;
  used: string | null;
  damaged: string | null;
  returned: string | null;
  variance: string | null;
  tolerance: string;
  withinTolerance: boolean | null;
  issuedBy: string | null;
  countedBy: string | null;
};
/** W2B: packaging component reconciliation (`packaging_reconciliations`; current rows: not voided, not superseded). */
export async function bmrPackagingReconciliations(q: DbOrTx, batchId: string): Promise<SourceResult<PackagingReconciliationRow>> {
  const r = await run<Row>(
    q,
    "packaging reconciliation",
    { packaging_reconciliations: ["batch_id", "material_id", "lot_id", "base_uom", "issued_qty", "used_qty", "damaged_qty", "returned_qty", "variance_qty", "tolerance_qty", "is_within_tolerance", "issued_by", "issued_at", "counted_by", "supersedes_id", "voided_at"] },
    sql`select m.name as material, l.lot_number, p.base_uom, p.issued_qty::text as issued, p.used_qty::text as used, p.damaged_qty::text as damaged,
               p.returned_qty::text as returned, p.variance_qty::text as variance, p.tolerance_qty::text as tolerance, p.is_within_tolerance,
               iu.display_name as issued_by, cu.display_name as counted_by
        from packaging_reconciliations p
        join materials m on m.id = p.material_id
        left join inventory_lots l on l.id = p.lot_id
        left join users iu on iu.id = p.issued_by
        left join users cu on cu.id = p.counted_by
        where p.batch_id = ${batchId} and p.voided_at is null
          and not exists (select 1 from packaging_reconciliations n where n.supersedes_id = p.id)
        order by p.issued_at`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      material: String(x.material),
      lot: str(x.lot_number),
      uom: String(x.base_uom),
      issued: String(x.issued),
      used: str(x.used),
      damaged: str(x.damaged),
      returned: str(x.returned),
      variance: str(x.variance),
      tolerance: String(x.tolerance ?? "0"),
      withinTolerance: x.is_within_tolerance === null || x.is_within_tolerance === undefined ? null : Boolean(x.is_within_tolerance),
      issuedBy: str(x.issued_by),
      countedBy: str(x.counted_by),
    })),
  };
}

export type BatchOutputRow = { kind: string; item: string; lot: string | null; qty: string; location: string | null };
/** W2B: output lines (`batch_outputs`). */
export async function bmrBatchOutputs(q: DbOrTx, batchId: string): Promise<SourceResult<BatchOutputRow>> {
  const r = await run<Row>(
    q,
    "batch outputs",
    { batch_outputs: ["batch_id", "line_no", "output_kind", "product_id", "material_id", "lot_id", "to_location_id", "qty_base", "base_uom"] },
    sql`select o.output_kind, coalesce(pr.name, m.name, '') as item, l.lot_number, o.qty_base::text || ' ' || o.base_uom as qty, loc.code as location
        from batch_outputs o
        left join products pr on pr.id = o.product_id
        left join materials m on m.id = o.material_id
        left join inventory_lots l on l.id = o.lot_id
        left join locations loc on loc.id = o.to_location_id
        where o.batch_id = ${batchId}
        order by o.line_no`,
  );
  return { available: r.available, rows: r.rows.map((x) => ({ kind: String(x.output_kind), item: String(x.item), lot: (x.lot_number as string) ?? null, qty: String(x.qty ?? ""), location: (x.location as string) ?? null })) };
}

export type InspectionRow = { number: string; plan: string | null; status: string; sampledBy: string | null; reviewedBy: string | null; reviewedAt: Date | null };
/** W2C: finished-product inspections of the batch (`inspections`). */
export async function bmrInspections(q: DbOrTx, batchId: string): Promise<SourceResult<InspectionRow>> {
  const r = await run<Row>(
    q,
    "inspections",
    { inspections: ["inspection_number", "batch_id", "status", "outcome", "inspection_kind", "inspection_plan_id", "sampled_by", "reviewed_by", "reviewed_at"] },
    sql`select i.inspection_number, i.status, i.outcome, i.inspection_kind, ip.code || ' rev ' || ip.revision_no as plan,
               su.display_name as sampled_by, ru.display_name as reviewed_by, i.reviewed_at
        from inspections i
        left join inspection_plans ip on ip.id = i.inspection_plan_id
        left join users su on su.id = i.sampled_by
        left join users ru on ru.id = i.reviewed_by
        where i.batch_id = ${batchId}
        order by i.inspection_number`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      number: String(x.inspection_number),
      plan: (x.plan as string) ?? null,
      status: `${String(x.inspection_kind).replace(/_/g, " ")}: ${String(x.status).replace(/_/g, " ")}${x.outcome ? ` (${String(x.outcome)})` : ""}`,
      sampledBy: (x.sampled_by as string) ?? null,
      reviewedBy: (x.reviewed_by as string) ?? null,
      reviewedAt: ts(x.reviewed_at),
    })),
  };
}

export type DeviationRow = { number: string; kind: string; severity: string; status: string; description: string; raisedBy: string | null; raisedAt: Date | null; closedBy: string | null; closedAt: Date | null };
/** W2C: deviations raised against the batch (`deviations`). */
export async function bmrDeviations(q: DbOrTx, batchId: string): Promise<SourceResult<DeviationRow>> {
  const r = await run<Row>(
    q,
    "deviations",
    { deviations: ["deviation_number", "status", "batch_id", "source", "severity", "description", "raised_by", "raised_at", "closed_by", "closed_at"] },
    // `source` (manual, oos, execution exception …) is the kind; severity is null until QA classifies it.
    sql`select d.deviation_number, d.source as deviation_kind, d.severity, d.status, d.description,
               ru.display_name as raised_by, d.raised_at, cu.display_name as closed_by, d.closed_at
        from deviations d
        left join users ru on ru.id = d.raised_by
        left join users cu on cu.id = d.closed_by
        where d.batch_id = ${batchId}
        order by d.raised_at`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      number: String(x.deviation_number),
      kind: String(x.deviation_kind),
      severity: x.severity === null || x.severity === undefined ? "unclassified" : String(x.severity),
      status: String(x.status),
      description: String(x.description),
      raisedBy: (x.raised_by as string) ?? null,
      raisedAt: ts(x.raised_at),
      closedBy: (x.closed_by as string) ?? null,
      closedAt: ts(x.closed_at),
    })),
  };
}

/** Deviations of the batch that are not closed (closure blocker). null = deviations not tracked yet. */
export async function openDeviationNumbers(q: DbOrTx, batchId: string): Promise<string[] | null> {
  const r = await bmrDeviations(q, batchId);
  if (!r.available) return null;
  return r.rows.filter((d) => d.status !== "closed" && d.status !== "cancelled").map((d) => d.number);
}
