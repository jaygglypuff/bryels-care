/**
 * The application job registry: every job the worker runs is listed here (docs/architecture.md §8).
 * To add a job: create `src/modules/<module>/jobs/<name>.ts` exporting `defineJob({...})`, then add
 * ONE import line and ONE list entry below. Enqueuing or running a code that is not in this list
 * fails; the registry test checks every code against the table in docs/architecture.md §8.
 */
import { analyticsReconcileKpisJob, analyticsSnapshotKpisJob } from "@/modules/analytics/jobs";
import { documentsRenderJob } from "@/modules/documents/jobs/render";
import { identitySessionPurgeJob } from "@/modules/identity/jobs";
import { platformAlertsEvaluateJob, platformMetricsSampleJob } from "@/modules/governance/jobs/metrics";
import { inventoryExpiryCheckJob, inventoryRebuildBalancesJob, inventoryReconcileJob, inventoryReservationExpiryJob } from "@/modules/inventory/jobs";
import { salesQuoteExpiryJob } from "@/modules/sales/quotations-expiry-job";
import { salesDeliveryReceiptReminderJob } from "@/modules/sales/jobs/dr-reminder"; // W3E
import { importJobProcessJob } from "@/modules/imports/jobs/process";
import { analyticsAccessReportJob, analyticsScheduleDispatchJob, analyticsScheduledReportJob } from "@/modules/reports/jobs";
import { platformActionCentreSweepJob } from "@/modules/action-centre/jobs";
import { procurementReorderSuggestJob } from "@/modules/procurement/jobs"; // W4A
import { type AnyJobDefinition, type JobRegistry, createJobRegistry } from "./job-definition";

/**
 * A function, not a constant: job modules import the platform runtime, which imports this file, so
 * the list is read at call time (after every module has finished loading), never at import time.
 */
export function jobDefinitions(): AnyJobDefinition[] {
  return [
    inventoryReconcileJob,
    inventoryRebuildBalancesJob,
    inventoryExpiryCheckJob,
    inventoryReservationExpiryJob,
    documentsRenderJob,
    identitySessionPurgeJob,
    platformMetricsSampleJob,
    platformAlertsEvaluateJob,
    salesQuoteExpiryJob,
    salesDeliveryReceiptReminderJob, // W3E (US-4-13)
    importJobProcessJob,
    // Wave 3 W3B: scheduled reports, weekly access report, action centre
    analyticsScheduleDispatchJob,
    analyticsScheduledReportJob,
    analyticsAccessReportJob,
    platformActionCentreSweepJob,
    analyticsSnapshotKpisJob,
    analyticsReconcileKpisJob,
    procurementReorderSuggestJob, // W4A (US-6-04)
  ];
}

let registry: JobRegistry | null = null;

export function appJobRegistry(): JobRegistry {
  registry ??= createJobRegistry(jobDefinitions());
  return registry;
}
