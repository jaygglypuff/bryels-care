import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { inspections, testResults } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { notifyNextActors } from "@/modules/governance";
import { notifyUsers } from "@/modules/platform/notifications";

/**
 * QA result hand-offs (ADR-109; end-to-end walk C9(c)): results entered → the second QA person who reviews them (never
 * anyone who entered a result, sod.results.reviewer_not_tester); reviewed → the first QA person(s) who entered them.
 * Both open the exact record (the batch's or lot's Check quality page). Once per hand-off and inspection state.
 */
type Ins = typeof inspections.$inferSelect;

const linkOf = (ins: Pick<Ins, "id" | "batchId" | "lotId">) => (ins.batchId ? `/quality/check/${ins.batchId}` : ins.lotId ? `/quality/lots/${ins.lotId}` : `/quality/inspections/${ins.id}`);

async function testers(q: DbOrTx, ins: Pick<Ins, "id" | "performedBy">): Promise<string[]> {
  const rows = await q.selectDistinct({ by: testResults.testedBy }).from(testResults).where(eq(testResults.inspectionId, ins.id));
  return [...new Set([ins.performedBy, ...rows.map((r) => r.by)].filter((x): x is string => !!x))];
}

/** Results are complete: tell the people who may review them. */
export async function notifyReviewNeeded(q: DbOrTx, ctx: AuthContext, ins: Ins): Promise<string[]> {
  return notifyNextActors(q, ctx, "qa_review", { siteId: ins.siteId, excludeUserIds: [ctx.userId, ...(await testers(q, ins))] }, {
    title: `Test results of ${ins.inspectionNumber} wait for your review`,
    body: `${ctx.displayName} entered the results. A second QA person reviews them.`,
    link: linkOf(ins),
    entityType: "inspection",
    entityId: ins.id,
    dedupeKey: `handoff.qa_review:${ins.id}:${Date.now()}`,
  });
}

/** The second QA person decided: tell the person(s) who entered the results. */
export async function notifyReviewDone(q: DbOrTx, ctx: AuthContext, ins: Ins, decision: "approve" | "reject" | "return"): Promise<string[]> {
  const to = (await testers(q, ins)).filter((u) => u !== ctx.userId);
  if (!to.length) return [];
  const words = decision === "approve" ? "approved your test results" : decision === "reject" ? "rejected the inspection" : "sent the results back for a retest";
  return notifyUsers(q, to, {
    organizationId: ctx.organizationId,
    siteId: ins.siteId,
    kind: "handoff.qa_review_done",
    severity: decision === "approve" ? "info" : "warning",
    title: `${ctx.displayName} ${words} (${ins.inspectionNumber})`,
    body: decision === "return" ? "Test again and enter the new results." : "Open it to see the decision.",
    entityType: "inspection",
    entityId: ins.id,
    link: linkOf(ins),
    dedupeKey: `handoff.qa_review_done:${ins.id}:${Date.now()}`,
  });
}
