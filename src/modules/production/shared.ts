import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { batches, idempotencyKeys, rolePermissions, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/**
 * Frozen copy stored on the batch at creation (batch snapshot rule, docs/data-model.md §4.4): the
 * approved formula revision with scaled lines, the approved routing revision with its steps
 * (parameters, checklist items, work-instruction text) and the finished-product inspection plan.
 * Fields added by W1D are optional so MVP-era snapshots still read.
 */
export type FormulaSnapshot = {
  schemaVersion?: "bom_snapshot/v2";
  formulaId?: string;
  formulaCode: string;
  formulaName: string;
  revisionNo: number;
  formulaRevisionId?: string;
  effectiveFrom?: string | null;
  referenceBatchSizeG: string;
  theoreticalYieldPct: string;
  takenAt?: string;
  routing?: { routingId: string; routingCode: string; routingName: string; routingRevisionId: string; revisionNo: number; effectiveFrom: string | null };
  inspectionPlan?: { id: string; code: string; revisionNo: number; isPlaceholder: boolean; tests: { testCode: string; name: string; valueKind: string; uom: string | null; specMin: string | null; specMax: string | null; specText: string | null; isRequired: boolean }[] } | null;
  lines: {
    bomLineId: string;
    lineNo: number;
    materialId: string;
    materialCode: string;
    materialName: string;
    inciName: string | null;
    quantityG: string;
    tolerancePct: string;
    toleranceAbsG?: string | null;
    scaling?: string;
    phaseCode?: string | null;
    targetQtyG?: string;
    requiresChecker?: boolean;
    /** Material kind at snapshot time (ADR-088 §3; absent on older batches = ingredient). */
    materialKind?: string;
  }[];
  /**
   * ADR-088 §3: the packaging lines of the batch (wrappers, labels, boxes): the recipe's packaging lines
   * (`recipe`) or, when the recipe has none, the per-piece setup (`per_piece`). Absent on older batches.
   */
  packaging?: { lineNo: number; materialId: string; materialCode: string; materialName: string; qty: string; baseUom: string; source: "recipe" | "per_piece"; perPiece?: string; extraPct?: string; pieces?: string }[];
  steps: {
    routingStepId: string;
    stepNo: number;
    name: string;
    stepKind: string;
    area?: string | null;
    instruction: string | null;
    requiresChecker: boolean;
    requiresEquipment?: boolean;
    equipmentKind?: string | null;
    workInstruction?: { code: string; name: string; revisionNo: number; revisionId: string; bodyMarkdown: string } | null;
    parameters?: { id: string; code: string; name: string; valueKind: string; uom: string | null; minValue: string | null; targetValue: string | null; maxValue: string | null; isRequired: boolean }[];
    checklistItems?: { id: string; itemNo: number; text: string; requiresPhoto: boolean; isBlocking: boolean }[];
  }[];
};

/** Step kinds that hold the ingredient weighing (MVP "weighing", routing vocabulary "dispensing"). */
export const WEIGHING_STEP_KINDS = ["dispensing", "weighing"] as const;
export const isWeighingStep = (kind: string) => (WEIGHING_STEP_KINDS as readonly string[]).includes(kind);

/** The permission a person must hold at the batch site to sign as checker (weighing and steps). */
export const CHECKER_PERMISSION = "production.dispense_record.approve" as const;

/** Today's calendar date in the plant's time zone (Asia/Manila), as YYYY-MM-DD. */
export function manilaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Loads a batch of the caller's organization with a row lock and checks site scope. */
export async function lockBatch(tx: Tx, ctx: AuthContext, batchId: string) {
  const [b] = await tx
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(b.siteId);
  return b;
}

/** Users who may sign as checker at a site: active, holding CHECKER_PERMISSION there (or org-wide). */
export async function eligibleCheckers(dbx: DbOrTx, organizationId: string, siteId: string) {
  return dbx
    .selectDistinct({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(userSiteAssignments, eq(userSiteAssignments.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, CHECKER_PERMISSION),
        activeAssignment(), // W2E: ended or future assignments do not count
        or(eq(userSiteAssignments.siteId, siteId), eq(userSiteAssignments.isOrganizationWide, true)),
      ),
    )
    .orderBy(users.displayName);
}

/** Separation of duties: the checker must be another eligible person at the batch site. */
export async function assertChecker(tx: Tx, ctx: AuthContext, siteId: string, checkerId: string | null | undefined) {
  if (!checkerId) throw new DomainError("validation", "Choose the checker who verified this.");
  if (ctx.sodBlocks(checkerId === ctx.userId, "The checker must be a different person from the operator. Ask a colleague to check and sign.")) {
    throw new DomainError("separation_of_duties", "The checker must be a different person from the operator. Ask a colleague to check and sign.", ctx.refusalDetails());
  }
  const list = await eligibleCheckers(tx, ctx.organizationId, siteId);
  const found = list.find((u) => u.id === checkerId);
  if (!found) throw new DomainError("validation", "The selected checker is not authorized to check production records at this site.");
  return found;
}

/**
 * Idempotent command wrapper (ADR-009): the first call stores its result under the key; a repeat
 * with the same key returns the stored result without re-running the command. Concurrent repeats
 * serialize on the unique index of idempotency_keys.
 */
export async function idempotent<T extends object>(
  tx: Tx,
  ctx: AuthContext,
  key: string | null | undefined,
  command: string,
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await fn(), replayed: false };
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ organizationId: ctx.organizationId, key, command })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (inserted.length === 0) {
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!row || row.command !== command) throw new DomainError("conflict", "This request key was already used for a different action. Reload the page and try again.");
    if (!row.result) throw new DomainError("conflict", "This request is still being processed. Reload the page in a moment.");
    return { result: row.result as T, replayed: true };
  }
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ result: sql`${JSON.stringify(result)}::jsonb` })
    .where(eq(idempotencyKeys.id, inserted[0].id));
  return { result, replayed: false };
}
