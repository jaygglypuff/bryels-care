import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { labelJobs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { createLabelJob, labelRequestOptions } from "@/modules/documents";

/**
 * A-RPT-10 (`labels.reprint_on_status_change`, default on for lots): after a QA decision changes a
 * lot's status, queue a new label for that lot so the printed status matches the system. Runs after
 * the decision committed; a label problem never undoes a decision, it is reported back instead.
 * Only lots that already had a label printed get one (boxes inherit status and are verified by scan).
 */
export async function queueStatusLabel(ctx: AuthContext, lot: { id: string; siteId: string; lotNumber: string }, key: string): Promise<{ queued: boolean; note: string | null }> {
  try {
    if (!(await getSetting(db, ctx.organizationId, "labels.reprint_on_status_change", lot.siteId))) return { queued: false, note: null };
    const [printed] = await db.select({ id: labelJobs.id, templateId: labelJobs.labelTemplateId }).from(labelJobs).where(and(eq(labelJobs.entityType, "inventory_lot"), eq(labelJobs.entityId, lot.id))).limit(1);
    if (!printed) return { queued: false, note: null };
    if (!ctx.can("inventory.label_job.create")) return { queued: false, note: `Lot ${lot.lotNumber}: the status label was not queued (you cannot create label jobs).` };
    if (lot.siteId !== ctx.currentSiteId) return { queued: false, note: `Lot ${lot.lotNumber} is at another site; print its new status label there.` };
    const opts = await labelRequestOptions(ctx, "inventory_lot", lot.id);
    const template = opts.templates.find((t) => t.id === printed.templateId) ?? opts.templates[0];
    if (!template) return { queued: false, note: `Lot ${lot.lotNumber}: no approved lot label template; print the new status label manually.` };
    await createLabelJob(ctx, { labelTemplateId: template.id, entityType: "inventory_lot", entityId: lot.id, copies: 1, printStationId: opts.stations[0]?.id ?? null, idempotencyKey: `status-label:${key}` });
    return { queued: true, note: null };
  } catch (e) {
    const msg = e instanceof DomainError ? e.message : "the label service failed";
    return { queued: false, note: `Lot ${lot.lotNumber}: new status label not queued (${msg}).` };
  }
}
