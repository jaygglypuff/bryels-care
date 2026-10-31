import "server-only";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { batches, processStepRecords, products } from "@/db/schema";
import { notifyUsers } from "@/modules/platform/notifications";
import type { JobRunContext } from "@/modules/platform/job-definition";
import { eligibleSigners } from "./execution";
import { WAIT_STEP_KINDS, shortDay } from "./flow-facts";
import { flowHref } from "./flow-paths";

/**
 * Curing / resting reminder (ADR-080 V2-5, UX review S8): when the minimum wait of a started curing
 * or hold step has passed, the people who may work on batches at the site (production.batch.edit)
 * get ONE action-centre notification per step record ("AS-2611-01: curing finished on Fri 28 Nov").
 * The dedupe key is the step record id, so the hourly job, its retries and a manual re-run never
 * notify twice. Nothing is changed on the batch; the operator taps "Curing finished".
 */
export async function dueWaits(q: DbOrTx, asOf: Date, organizationId?: string) {
  return q
    .select({ rec: processStepRecords, batchNumber: batches.batchNumber, organizationId: batches.organizationId, siteId: batches.siteId, workOrderId: batches.workOrderId, productName: products.name })
    .from(processStepRecords)
    .innerJoin(batches, eq(batches.id, processStepRecords.batchId))
    .innerJoin(products, eq(products.id, batches.productId))
    .where(
      and(
        inArray(processStepRecords.stepKind, [...WAIT_STEP_KINDS]),
        eq(processStepRecords.status, "in_progress"),
        isNotNull(processStepRecords.earliestCompletionAt),
        lte(processStepRecords.earliestCompletionAt, asOf),
        eq(batches.status, "in_process"),
        organizationId ? eq(batches.organizationId, organizationId) : undefined,
      ),
    );
}

export async function remindCuringReady(run: Pick<JobRunContext, "asOf"> & { ctx?: { organizationId: string } }) {
  let notified = 0;
  let steps = 0;
  for (const w of await dueWaits(db, run.asOf, run.ctx?.organizationId)) {
    steps += 1;
    const people = await eligibleSigners(db, w.organizationId, w.siteId, "production.batch.edit");
    const word = /mou?ld/i.test(w.rec.name) ? "mould time" : w.rec.stepKind === "hold" ? "resting" : "curing";
    const link = flowHref({ batchId: w.rec.batchId, workOrderId: w.workOrderId }, `step/${w.rec.stepNo}`);
    const ids = await notifyUsers(
      db,
      people.map((p) => p.id),
      {
        organizationId: w.organizationId,
        siteId: w.siteId,
        kind: "production.curing.ready",
        severity: "info",
        title: `${w.batchNumber}: ${word} finished on ${shortDay(w.rec.earliestCompletionAt!)}`,
        body: `${w.productName}, step ${w.rec.stepNo} (${w.rec.name}). Open the batch and tap "${word === "mould time" ? "Mould time" : word === "resting" ? "Resting" : "Curing"} finished".`,
        entityType: "batch",
        entityId: w.rec.batchId,
        link,
        dedupeKey: `curing-ready:${w.rec.id}`,
      },
    );
    notified += ids.length;
  }
  return { steps, notified };
}
