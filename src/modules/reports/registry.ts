import "server-only";
import { auditExtractReport, accessReport } from "./defs/audit";
import { expiryReport, movementsReport, receiptsReport, stockOnHandReport } from "./defs/inventory";
import { batchYieldReport, workOrdersReport } from "./defs/production";
import { deviationsReport, dispositionsReport, holdsReport } from "./defs/quality";
import { salesOrdersReport, shipmentsReport } from "./defs/sales";
import { capaReport, maintenanceReport } from "./defs/quality-system"; // Wave 4 W4C
import type { ReportDefinition } from "./types";

/**
 * The report registry (US-5-04). Codes follow docs/analytics-kpis.md §5.1. Reports whose data does
 * not exist yet (valuation, OTIF, supplier performance, finance, HR) are not registered; the library
 * lists them as planned with their phase instead of faking output.
 */
export const REPORTS: readonly ReportDefinition[] = [
  stockOnHandReport,
  expiryReport,
  movementsReport,
  receiptsReport,
  batchYieldReport,
  workOrdersReport,
  dispositionsReport,
  deviationsReport,
  holdsReport,
  capaReport, // Wave 4 W4C
  maintenanceReport, // Wave 4 W4C
  salesOrdersReport,
  shipmentsReport,
  auditExtractReport,
  accessReport,
];

{
  const codes = REPORTS.map((r) => r.code);
  const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dup.length) throw new Error(`Duplicate report codes: ${dup.join(", ")}`);
}

export function reportByCode(code: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.code === code);
}

/** Catalogue entries whose data arrives in later phases (docs/analytics-kpis.md §5.1): shown, never run. */
export const PLANNED_REPORTS: { code: string; title: string; phase: string }[] = [
  { code: "RPT-OWN-DAILY", title: "Owner daily digest (KPI row)", phase: "with the KPI snapshots (US-5-01/02)" },
  { code: "RPT-OWN-WEEKLY", title: "Owner weekly review", phase: "with the KPI snapshots (US-5-01/02)" },
  { code: "RPT-INV-VALUATION", title: "Stock valuation and aging", phase: "Phase 6 (costing)" },
  { code: "RPT-SAL-OTIF", title: "Customer service monthly (OTIF, fill rate)", phase: "with order-line due dates and pricing" },
  { code: "RPT-HR-IMPORT", title: "Attendance import exception report", phase: "Phase 5 HR (attendance imports)" },
  { code: "RPT-PRO-SUPPLIER", title: "Supplier performance", phase: "Phase 6 (procurement)" },
  { code: "RPT-FIN-AGING", title: "AR / AP aging", phase: "Phase 6 (finance)" },
];
