import "server-only";
import type { Tx } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { type DeviationKind, type OpenDeviationInput, registerExecutionHooks } from "@/modules/production";
import {
  type DeviationSource,
  changeControlApprovalCandidates,
  ensureBatchInspection,
  inProcessQcStatus,
  listComplaints,
  openDeviation,
  overdueCapaActionCandidates,
  recallCaseCandidates,
} from "@/modules/quality";
import { pmDueCandidates, usageAvailabilityReasons } from "@/modules/maintenance";
import { registerEquipmentAvailabilityProvider } from "@/modules/masterdata";
import { registerActionItemSource } from "@/modules/action-centre";
import { customersKind, failedImportCandidates, importApprovalCandidates, importWizardStats, registerImportKind } from "@/modules/imports";
import { registerImportStatsProvider } from "@/modules/platform/diagnostics-phase5";
import { registerReceivingPoHooks } from "@/modules/inventory";
import {
  aslApprovalCandidates,
  latePoCandidates,
  overDeliveryCandidates,
  poApprovalCandidates,
  prApprovalCandidates,
  purchaseOrderReceivingHooks,
  srApprovalCandidates,
  supplierMaterialsKind,
} from "@/modules/procurement";
import { listCustomerReturns, registerCustomer360Section, registerSalesTaxRateResolver, RETURN_STATUS_LABEL, type CustomerReturnStatus } from "@/modules/sales";
import { disputedBills, expenseClaimsToApprove, invoicesToApprove, overdueInvoices, salesTaxRateFor } from "@/modules/finance";

/**
 * Cross-module wiring (Wave 2 and Wave 3 integration). Batch execution (production) must not import
 * the quality module (quality imports production), so quality's services are plugged into the
 * execution hooks here. Wave 3: complaints and returns as customer-360 sections (sales must not import
 * quality), the customers import kind on W3D's customer service, and the import wizard's action-centre
 * items and diagnostics statistics (the action centre and diagnostics never import the imports module). Wave 4 W4C:
 * CAPA, recall-case, change-control and PM items in the action centre, and usage-based PM plans in the W1D
 * equipment gate (masterdata must not import maintenance). `registerAppHooks()` is idempotent and is called:
 *
 * - at web server start (src/instrumentation.ts `register`),
 * - at worker start (src/worker.ts),
 * - by the batch-execution server actions and API routes (cheap; covers a cold route bundle),
 * - by integration tests that exercise the connected behaviour.
 *
 * The hook registry lives on globalThis (one per process), so every Next bundle sees it.
 */

/** Execution exception kinds → deviation source (docs/data-model.md §3.6 `deviations.source`). */
const SOURCE: Record<DeviationKind, DeviationSource> = {
  out_of_tolerance: "cx_tol",
  equipment_override: "cx_cal",
  failed_check: "in_process_check",
  yield_out_of_range: "yield",
  reconciliation_mismatch: "reconciliation",
  skipped_step: "other",
  other: "other",
};

async function openExecutionDeviation(tx: Tx, ctx: AuthContext, input: OpenDeviationInput) {
  // The deviation is about the batch; the weighed material lot is named in the description only, so a
  // deviation on a batch never blocks decisions on a shared raw-material lot.
  const r = await openDeviation(
    ctx,
    {
      batchId: input.batchId,
      processStepRecordId: input.processStepRecordId ?? null,
      dispenseRecordId: input.dispenseRecordId ?? null,
      source: SOURCE[input.kind],
      description: input.description,
    },
    { tx },
  );
  return { deviationId: r.deviationId, deviationNumber: r.deviationNumber };
}

/** Registers (again) every cross-module hook; repeated calls replace the same entries. */
export function registerAppHooks() {
  registerExecutionHooks({
    openDeviation: openExecutionDeviation,
    inProcessQcStatus: (tx, ctx, input) => inProcessQcStatus(tx, ctx, input),
    createFinishedProductInspection: async (tx, ctx, input) => {
      const r = await ensureBatchInspection(tx, ctx, input.batchId);
      return r ? { inspectionId: r.inspectionId } : null;
    },
  });
  // Wave 3 W3F → W3D customer 360 (US-4-06): complaints and returns of the customer, each section only for
  // holders of its view permission; rows are scoped to the viewer's sites by the list services.
  registerCustomer360Section({
    key: "complaints",
    title: "Complaints",
    permission: "quality.complaint.view",
    load: async (ctx, customerId) =>
      (await listComplaints(ctx, { status: "all", customerId })).slice(0, 20).map((c) => ({
        id: c.id,
        label: c.number,
        sublabel: [c.category.replace(/_/g, " "), c.lotNumber ? `lot ${c.lotNumber}` : null, c.severity].filter(Boolean).join(" · "),
        status: c.status,
        href: `/quality/complaints/${c.id}`,
        at: c.receivedAt,
      })),
  });
  registerCustomer360Section({
    key: "returns",
    title: "Customer returns",
    permission: "sales.customer_return.view",
    load: async (ctx, customerId) =>
      (await listCustomerReturns(ctx, { status: "all", customerId })).slice(0, 20).map((r) => ({
        id: r.id,
        label: r.number,
        sublabel: [r.drNumber ? `DR ${r.drNumber}` : null, RETURN_STATUS_LABEL[r.status as CustomerReturnStatus] ?? r.status].filter(Boolean).join(" · "),
        status: r.status,
        href: `/sales/returns/${r.id}`,
        at: r.receivedAt ?? r.createdAt,
      })),
  });
  // Wave 3 W3C on W3D: customers import kind (replaces the placeholder of src/modules/imports/kinds).
  registerImportKind(customersKind);
  // Wave 3 W3C → W3B: failed imports and imports to approve in the action centre; wizard runs in diagnostics.
  registerActionItemSource({ kind: "failed_import", detect: (org) => failedImportCandidates(org) });
  registerActionItemSource({ kind: "approval.import_job", detect: (org) => importApprovalCandidates(org) });
  registerImportStatsProvider("import_wizard", (org) => importWizardStats(org));
  // Wave 4 W4A: PO receipts (inventory receiving ← procurement rules), procurement action items, supplier-material import kind.
  registerReceivingPoHooks(purchaseOrderReceivingHooks);
  registerActionItemSource({ kind: "approval.purchase_order", detect: (org) => poApprovalCandidates(org) });
  registerActionItemSource({ kind: "approval.purchase_request", detect: (org) => prApprovalCandidates(org) });
  registerActionItemSource({ kind: "approval.supplier_return", detect: (org) => srApprovalCandidates(org) });
  registerActionItemSource({ kind: "approval.asl_change", detect: (org) => aslApprovalCandidates(org) });
  registerActionItemSource({ kind: "late_purchase_order", detect: (org, now) => latePoCandidates(org, now) });
  registerActionItemSource({ kind: "over_delivery", detect: (org) => overDeliveryCandidates(org) });
  registerImportKind(supplierMaterialsKind);
  // Wave 4 W4B: quotes and orders take the sales tax rate from finance's reviewed tax configuration (US-6-14;
  // replaces W3D's setting sales.tax.rate_pct), and finance feeds the action centre.
  registerSalesTaxRateResolver((q, org, onDate) => salesTaxRateFor(q, org, onDate));
  registerActionItemSource({ kind: "approval.invoice", detect: (org) => invoicesToApprove(org) });
  registerActionItemSource({ kind: "overdue_invoice", detect: (org, now) => overdueInvoices(org, now) });
  registerActionItemSource({ kind: "disputed_bill", detect: (org) => disputedBills(org) });
  registerActionItemSource({ kind: "approval.expense_claim", detect: (org) => expenseClaimsToApprove(org) });
  // Wave 4 W4C (US-6-18, US-6-19): overdue CAPA actions, recall cases and their approval, change control
  // approval and PM plans due/overdue in the action centre; usage-based PM plans in the equipment gate.
  registerActionItemSource({ kind: "overdue_capa_action", detect: (org, now) => overdueCapaActionCandidates(org, now) });
  registerActionItemSource({ kind: "open_recall_case", detect: async (org) => (await recallCaseCandidates(org)).filter((c) => c.kind === "open_recall_case") });
  registerActionItemSource({ kind: "approval.recall_case", detect: async (org) => (await recallCaseCandidates(org)).filter((c) => c.kind === "approval.recall_case") });
  registerActionItemSource({ kind: "approval.change_control", detect: (org) => changeControlApprovalCandidates(org) });
  registerActionItemSource({ kind: "pm_due", detect: async (org, now) => (await pmDueCandidates(org, now)).filter((c) => c.kind === "pm_due") });
  registerActionItemSource({ kind: "pm_overdue", detect: async (org, now) => (await pmDueCandidates(org, now)).filter((c) => c.kind === "pm_overdue") });
  registerEquipmentAvailabilityProvider("maintenance.usage_plans", (q, ids) => usageAvailabilityReasons(q, ids));
}
