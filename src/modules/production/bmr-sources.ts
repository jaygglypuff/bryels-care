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
    { process_step_checklist_results: ["process_step_record_id", "routing_step_checklist_item_id", "answer", "note", "answered_by", "answered_at"] },
    sql`select psr.step_no, psr.name as step_name, i.item_no, i.text, c.answer, c.note, u.display_name as answered_by, c.answered_at
        from process_step_checklist_results c
        join process_step_records psr on psr.id = c.process_step_record_id
        join routing_step_checklist_items i on i.id = c.routing_step_checklist_item_id
        left join users u on u.id = c.answered_by
        where psr.batch_id = ${batchId}
        order by psr.step_no, i.item_no`,
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
    { process_step_readings: ["process_step_record_id", "routing_step_parameter_id", "value_numeric", "value_text", "value_boolean", "is_within_limits", "recorded_at", "recorded_by", "supersedes_id", "correction_reason"] },
    sql`select psr.step_no, p.name as parameter, p.uom, p.min_value, p.target_value, p.max_value,
               coalesce(r.value_numeric::text, r.value_text, case when r.value_boolean is null then null when r.value_boolean then 'yes' else 'no' end) as value,
               r.is_within_limits, u.display_name as recorded_by, r.recorded_at,
               exists (select 1 from process_step_readings n where n.supersedes_id = r.id) as superseded,
               (select n.correction_reason from process_step_readings n where n.supersedes_id = r.id limit 1) as correction_reason
        from process_step_readings r
        join process_step_records psr on psr.id = r.process_step_record_id
        join routing_step_parameters p on p.id = r.routing_step_parameter_id
        left join users u on u.id = r.recorded_by
        where psr.batch_id = ${batchId}
        order by psr.step_no, p.sequence, r.recorded_at`,
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

export type EquipmentUseRow = { stepNo: number | null; code: string; name: string; calibrationDue: string | null; cleaning: string | null; operator: string | null; startedAt: Date | null; exceptionReason: string | null };
/** W2B: equipment used on the batch (`equipment_uses`), with the evidence snapshot at use. */
export async function bmrEquipmentUses(q: DbOrTx, batchId: string): Promise<SourceResult<EquipmentUseRow>> {
  const r = await run<Row>(
    q,
    "equipment use",
    { equipment_uses: ["batch_id", "equipment_id", "process_step_record_id", "started_at", "operator_id", "cleaning_status_at_start", "calibration_due_date_at_use", "exception_reason"] },
    sql`select psr.step_no, e.code, e.name, eu.calibration_due_date_at_use::text as calibration_due, eu.cleaning_status_at_start as cleaning,
               u.display_name as operator, eu.started_at, eu.exception_reason
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
      exceptionReason: (x.exception_reason as string) ?? null,
    })),
  };
}

export type YieldRecordRow = { theoretical: string; actual: string; variance: string; variancePct: string | null; labelsIssued: number | null; labelsUsed: number | null; labelsDestroyed: number | null; packagingNotes: string | null; recordedBy: string | null; checkedBy: string | null; recordedAt: Date | null };
/** W2B: the current yield / packaging reconciliation record (`yield_records`, latest not superseded). */
export async function bmrYieldRecord(q: DbOrTx, batchId: string): Promise<SourceResult<YieldRecordRow>> {
  const r = await run<Row>(
    q,
    "yield and packaging reconciliation",
    { yield_records: ["batch_id", "theoretical_base", "actual_base", "variance_base", "variance_pct", "labels_issued", "labels_used", "labels_destroyed", "packaging_notes", "recorded_by", "checked_by", "supersedes_id"] },
    sql`select y.theoretical_base::text as theoretical, y.actual_base::text as actual, y.variance_base::text as variance, y.variance_pct::text as variance_pct,
               y.labels_issued, y.labels_used, y.labels_destroyed, y.packaging_notes,
               ru.display_name as recorded_by, cu.display_name as checked_by, y.created_at as recorded_at
        from yield_records y
        left join users ru on ru.id = y.recorded_by
        left join users cu on cu.id = y.checked_by
        where y.batch_id = ${batchId} and not exists (select 1 from yield_records n where n.supersedes_id = y.id)
        order by y.created_at desc limit 1`,
  );
  return {
    available: r.available,
    rows: r.rows.map((x) => ({
      theoretical: String(x.theoretical),
      actual: String(x.actual),
      variance: String(x.variance),
      variancePct: (x.variance_pct as string) ?? null,
      labelsIssued: x.labels_issued === null || x.labels_issued === undefined ? null : Number(x.labels_issued),
      labelsUsed: x.labels_used === null || x.labels_used === undefined ? null : Number(x.labels_used),
      labelsDestroyed: x.labels_destroyed === null || x.labels_destroyed === undefined ? null : Number(x.labels_destroyed),
      packagingNotes: (x.packaging_notes as string) ?? null,
      recordedBy: (x.recorded_by as string) ?? null,
      checkedBy: (x.checked_by as string) ?? null,
      recordedAt: ts(x.recorded_at),
    })),
  };
}

export type BatchOutputRow = { kind: string; item: string; lot: string | null; qty: string; location: string | null };
/** W2B: output lines (`batch_outputs`). */
export async function bmrBatchOutputs(q: DbOrTx, batchId: string): Promise<SourceResult<BatchOutputRow>> {
  const r = await run<Row>(
    q,
    "batch outputs",
    { batch_outputs: ["batch_id", "line_no", "output_kind", "material_id", "lot_id", "to_location_id", "qty_base"] },
    sql`select o.output_kind, coalesce(m.name, '') as item, l.lot_number, o.qty_base::text as qty, loc.code as location
        from batch_outputs o
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
    { inspections: ["inspection_number", "batch_id", "status", "reviewed_by", "reviewed_at"] },
    sql`select i.inspection_number, i.status, ru.display_name as reviewed_by, i.reviewed_at
        from inspections i
        left join users ru on ru.id = i.reviewed_by
        where i.batch_id = ${batchId}
        order by i.inspection_number`,
  );
  return { available: r.available, rows: r.rows.map((x) => ({ number: String(x.inspection_number), plan: null, status: String(x.status), sampledBy: null, reviewedBy: (x.reviewed_by as string) ?? null, reviewedAt: ts(x.reviewed_at) })) };
}

export type DeviationRow = { number: string; kind: string; severity: string; status: string; description: string; raisedBy: string | null; raisedAt: Date | null; closedBy: string | null; closedAt: Date | null };
/** W2C: deviations raised against the batch (`deviations`). */
export async function bmrDeviations(q: DbOrTx, batchId: string): Promise<SourceResult<DeviationRow>> {
  const r = await run<Row>(
    q,
    "deviations",
    { deviations: ["deviation_number", "status", "batch_id", "deviation_kind", "severity", "description", "raised_by", "raised_at", "closed_by", "closed_at"] },
    sql`select d.deviation_number, d.deviation_kind, d.severity, d.status, d.description,
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
      severity: String(x.severity),
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
  return r.rows.filter((d) => d.status !== "closed").map((d) => d.number);
}
