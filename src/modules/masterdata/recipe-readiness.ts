import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { formulaRevisions, formulas, routingRevisions, routings, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { HANDOFFS, nextActors, peopleWords } from "@/modules/governance";
import { peopleWithOwnerAlone } from "@/lib/next-actors-words";
import { loadApprovalPolicy } from "./approval-policy";
import { type PartState, type Readiness, readiness } from "./recipe-readiness-words";
import { policyFor } from "./routings";
import { approvalState, businessToday } from "./versioning";

/**
 * Can a product be made on a date (owner bug report 2026-11-06, ADR-116)? Both its recipe (formula) and its steps
 * (routing) need an approved version in use on that date (V-REV, the rule batch creation and order approval apply).
 * When one is missing, says why in one plain sentence and names who acts next (`nextActors`, the same people the
 * approval notification goes to). A read for screens and for the production order refusal; it decides nothing.
 * Scoped to the caller's organization; recipes and steps are organization records (no site).
 */

type Rev = { id: string; status: string; revisionNo: number; effectiveFrom: string | null; effectiveTo: string | null; createdBy: string | null; submittedBy: string | null; changeScope?: string | null };

const inUse = (r: Rev, date: string) => r.status === "approved" && !!r.effectiveFrom && r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo > date);

async function partState(ctx: AuthContext, q: DbOrTx, recordType: "formula_revision" | "routing_revision", revs: Rev[], date: string): Promise<PartState> {
  if (revs.some((r) => inUse(r, date))) return { kind: "ready" };
  const pending = revs.find((r) => r.status === "pending_approval");
  if (pending) return { kind: "waiting", by: await approversWords(ctx, q, recordType, pending) };
  const later = revs.filter((r) => r.status === "approved" && r.effectiveFrom && r.effectiveFrom > date).sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))[0];
  if (later) return { kind: "later", from: fmtDate(later.effectiveFrom) };
  const draft = revs.find((r) => r.status === "draft");
  if (draft) {
    const [u] = draft.createdBy ? await q.select({ name: users.displayName }).from(users).where(eq(users.id, draft.createdBy)).limit(1) : [];
    return { kind: "draft", who: draft.createdBy === ctx.userId ? "you" : u ? u.name.trim().split(/\s+/)[0] : "the person who makes recipes" };
  }
  return { kind: "none" };
}

/** The people of the version's open approval step: "you or Nina (QA)", "Nina (QA)", or the role words when nobody holds it. */
async function approversWords(ctx: AuthContext, q: DbOrTx, recordType: "formula_revision" | "routing_revision", rev: Rev): Promise<string> {
  const policy = recordType === "routing_revision" ? await policyFor(q, ctx.organizationId, rev.changeScope ?? null) : await loadApprovalPolicy(q, ctx.organizationId, recordType);
  const state = await approvalState(q, ctx.organizationId, recordType, rev.id, policy);
  const step = state.nextStep;
  const kind = recordType === "formula_revision" ? "recipe_revision" : "routing_revision";
  if (!step) return HANDOFFS[kind].fallback;
  const qa = step.roles.includes("qa_qc");
  const n = await nextActors(
    ctx,
    { ...HANDOFFS[kind], kind, independent: qa, operational: !qa },
    {
      siteId: null,
      roleCodes: step.roles,
      permission: step.permission,
      excludeUserIds: [rev.createdBy, rev.submittedBy],
      priorApproverIds: state.decisions.filter((d) => d.decision === "approved").map((d) => d.decidedBy),
      stepNo: step.step,
      stepsTotal: state.policy.length,
      roleStandIn: false,
    },
    q,
  ).catch(() => null);
  if (!n) return HANDOFFS[kind].fallback;
  // ADR-117: "Nina (QA) or Teresa (QA) — or Ana (owner) alone"; the owner reads "you alone (you are the owner) or …".
  const others = peopleWithOwnerAlone(n);
  if (n.viewer.ownerAlone) return n.people.length ? `you alone (you are the owner) or ${peopleWords(n.people)}` : "you alone (you are the owner)";
  if (n.viewer.can) return others ? `you or ${others}` : "you";
  return others || n.roleWords;
}

/** Readiness of each product on `date` (default: today in Manila). */
export async function recipeReadiness(ctx: AuthContext, productIds: readonly string[], date: string = businessToday(), q: DbOrTx = db): Promise<Map<string, Readiness>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, Readiness>();
  if (!ids.length) return out;
  const fRows = await q
    .select({ productId: formulas.productId, rev: formulaRevisions })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .where(and(eq(formulas.organizationId, ctx.organizationId), inArray(formulas.productId, ids)))
    .orderBy(desc(formulaRevisions.revisionNo));
  const rRows = await q
    .select({ productId: routings.productId, rev: routingRevisions })
    .from(routingRevisions)
    .innerJoin(routings, eq(routings.id, routingRevisions.routingId))
    .where(and(eq(routings.organizationId, ctx.organizationId), inArray(routings.productId, ids)))
    .orderBy(desc(routingRevisions.revisionNo));
  for (const id of ids) {
    const recipe = await partState(ctx, q, "formula_revision", fRows.filter((r) => r.productId === id).map((r) => r.rev), date);
    const steps = await partState(ctx, q, "routing_revision", rRows.filter((r) => r.productId === id).map((r) => r.rev), date);
    out.set(id, readiness(recipe, steps));
  }
  return out;
}

/** One product. */
export async function productReadiness(ctx: AuthContext, productId: string, date: string = businessToday(), q: DbOrTx = db): Promise<Readiness> {
  return (await recipeReadiness(ctx, [productId], date, q)).get(productId)!;
}
