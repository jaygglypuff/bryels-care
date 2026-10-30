import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { changeControls, recallCases, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { type ApprovalVerdict, stepVerdict } from "@/modules/governance";
import { qualityApprovalProgress } from "./recall-cases-approvals";

/**
 * "To approve" verdicts for change controls and recall cases (ADR-075, ADR-082 §4; registered in
 * src/modules/wiring.ts): the same steps, roles and same-person rules as `decideChangeControl` and the
 * recall-case decision (recordQualityDecision), read only.
 */
const approversOf = (p: { steps: { approvals: { by: string }[] }[] }) => p.steps.flatMap((s) => s.approvals.map((a) => a.by));

export async function changeControlApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ c: changeControls, by: users.displayName })
    .from(changeControls)
    .leftJoin(users, eq(users.id, changeControls.submittedBy))
    .where(and(eq(changeControls.organizationId, ctx.organizationId), inArray(changeControls.id, ids), inArray(changeControls.siteId, ctx.allowedSiteIds), eq(changeControls.status, "submitted")));
  for (const { c, by } of rows) {
    const p = await qualityApprovalProgress(db, ctx.organizationId, { recordType: "change_control", recordId: c.id, siteId: c.siteId });
    const v = stepVerdict(ctx, { step: p.next, basePermission: "quality.change_control.approve", siteId: c.siteId, pendingSince: c.submittedAt, excludedUserIds: [c.createdBy, c.submittedBy], priorApproverIds: approversOf(p) });
    out.set(c.id, { ...v, requestedById: c.submittedBy, requestedByName: by, title: c.title, why: c.justification ? c.justification.slice(0, 160) : null });
  }
  return out;
}

export async function recallCaseApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ c: recallCases, by: users.displayName })
    .from(recallCases)
    .leftJoin(users, eq(users.id, recallCases.submittedBy))
    .where(and(eq(recallCases.organizationId, ctx.organizationId), inArray(recallCases.id, ids), inArray(recallCases.originSiteId, ctx.allowedSiteIds), eq(recallCases.status, "submitted")));
  for (const { c, by } of rows) {
    const p = await qualityApprovalProgress(db, ctx.organizationId, { recordType: "recall_case", recordId: c.id, siteId: null });
    const v = stepVerdict(ctx, { step: p.next, basePermission: "quality.recall_case.approve", siteId: null, pendingSince: c.submittedAt, excludedUserIds: [c.openedBy, c.submittedBy], priorApproverIds: approversOf(p) });
    out.set(c.id, { ...v, requestedById: c.submittedBy, requestedByName: by, title: c.title });
  }
  return out;
}
