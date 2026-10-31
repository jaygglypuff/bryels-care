import "server-only";
import { and, arrayContains, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { REASON_CATEGORIES, type ReasonCategory, reasonCodes } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertUuid, bool, codeFromName, diff, optInt, optText, optionalCode, reqText, uniqueConflict } from "./org-common";
import { DEFAULT_REASON_CODES, REASON_NOTE_MAX, reasonCodesFor } from "./reason-codes-defaults";
import { parseInput } from "./schemas";
import { runInTx, type InTx } from "@/lib/tx";

/**
 * Shared reason codes (US-1-24). One table, categories in `applies_to`. Commands that need a
 * reason call `assertReasonCode` (no extra permission: the caller already holds the command's
 * permission); pickers call `reasonCodeOptions`. Codes are immutable (trigger
 * tg_reason_codes_code_immutable); deactivating keeps history readable and blocks new use.
 */

export const REASON_CATEGORY_LABELS: Record<ReasonCategory, string> = {
  adjustment: "Stock adjustment",
  transfer: "Transfer",
  receipt: "Unplanned receipt",
  disposition: "QA disposition",
  sample: "Sample",
  scrap: "Scrap",
  rework: "Rework",
  return: "Return",
  count_variance: "Count variance",
  hold: "QA hold",
  reprint: "Label / document reprint",
  deviation: "Deviation",
  reversal: "Reversal",
  exception: "Controlled exception",
  cancel: "Cancellation",
  downtime: "Downtime",
  audit: "Audited action",
};

const appliesTo = z
  .array(z.enum(REASON_CATEGORIES, { message: "Choose a valid category." }))
  .min(1, "Choose at least one place the code is used.")
  .transform((a) => [...new Set(a)]);
const ReasonCodeCreate = z
  .object({
    /** ADR-088: optional; blank = made from the label ("Pest found" → pest_found). */
    code: optionalCode(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z][a-z0-9_]{0,39}$/, "Code: lower-case letters, digits and underscore, starting with a letter (max 40), e.g. spillage."),
    ),
    name: reqText("the label people see", 120),
    description: optText(500),
    appliesTo,
    requiresNote: bool(false),
    requiresApproval: bool(false),
    sortOrder: optInt("Sort order", 0, 9999),
  })
  .strict();
const ReasonCodeUpdate = ReasonCodeCreate.omit({ code: true }).extend({ isActive: bool(true) }).strict();

export type ReasonCodeRow = typeof reasonCodes.$inferSelect;

export async function listReasonCodes(ctx: AuthContext, opts: { category?: string; includeInactive?: boolean } = {}) {
  ctx.require("masterdata.reason_code.view");
  const rows = await db
    .select()
    .from(reasonCodes)
    .where(and(eq(reasonCodes.organizationId, ctx.organizationId), opts.includeInactive ? undefined : eq(reasonCodes.isActive, true), opts.category && (REASON_CATEGORIES as readonly string[]).includes(opts.category) ? arrayContains(reasonCodes.appliesTo, [opts.category]) : undefined))
    .orderBy(asc(reasonCodes.sortOrder), asc(reasonCodes.code));
  return rows;
}

export async function getReasonCode(ctx: AuthContext, id: string) {
  ctx.require("masterdata.reason_code.view");
  assertUuid(id, "Reason code");
  const [r] = await db.select().from(reasonCodes).where(and(eq(reasonCodes.id, id), eq(reasonCodes.organizationId, ctx.organizationId))).limit(1);
  if (!r) throw new DomainError("not_found", "Reason code not found.");
  return r;
}

type CategoryRow = { code: string; name: string; appliesTo: string[]; requiresNote: boolean; requiresApproval: boolean; isActive: boolean; sortOrder: number };

/**
 * The organization's codes for a category. When the organization has none for it (reference data not
 * installed yet: a fresh database before `pnpm db:reference`), the shipped defaults stand in, so a
 * command never loses its reason list; installing writes the same codes as rows.
 */
async function categoryRows(q: DbOrTx, organizationId: string, category: ReasonCategory): Promise<CategoryRow[]> {
  const rows = await q
    .select({ code: reasonCodes.code, name: reasonCodes.name, appliesTo: reasonCodes.appliesTo, requiresNote: reasonCodes.requiresNote, requiresApproval: reasonCodes.requiresApproval, isActive: reasonCodes.isActive, sortOrder: reasonCodes.sortOrder })
    .from(reasonCodes)
    .where(and(eq(reasonCodes.organizationId, organizationId), arrayContains(reasonCodes.appliesTo, [category])));
  if (rows.length) return rows;
  return DEFAULT_REASON_CODES.filter((r) => r.appliesTo.includes(category)).map((r) => ({
    code: r.code,
    name: r.name,
    appliesTo: [...r.appliesTo],
    requiresNote: r.requiresNote ?? false,
    requiresApproval: r.requiresApproval ?? false,
    isActive: true,
    sortOrder: r.sortOrder,
  }));
}

/** Codes a command may offer for a category (active only, display order). */
export async function reasonCodeOptions(q: DbOrTx, organizationId: string, category: ReasonCategory) {
  return reasonCodesFor(await categoryRows(q, organizationId, category), category).map((r) => ({ code: r.code, label: r.name, requiresNote: r.requiresNote, requiresApproval: r.requiresApproval }));
}

/** Display labels of stored codes (history keeps the code; a deactivated or unknown code shows as itself). */
export async function reasonLabels(q: DbOrTx, organizationId: string, codes: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(codes.filter((c): c is string => !!c))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const rows = await q.select({ code: reasonCodes.code, name: reasonCodes.name }).from(reasonCodes).where(and(eq(reasonCodes.organizationId, organizationId), inArray(reasonCodes.code, wanted)));
  for (const r of rows) out.set(r.code, r.name);
  for (const c of wanted) if (!out.has(c)) out.set(c, DEFAULT_REASON_CODES.find((d) => d.code === c)?.name ?? c);
  return out;
}

/**
 * Validates a reason for a new record (US-1-24 AC1, AC2): the code must be active and apply to
 * the category; requires_note forces a note (max 500 characters). Returns the code row so the
 * caller can read requires_approval. Field errors name `reasonCode` / `reasonNote`.
 */
export async function assertReasonCode(q: DbOrTx, organizationId: string, category: ReasonCategory, code: string | null | undefined, note?: string | null) {
  const c = (code ?? "").trim();
  if (!c) throw new DomainError("validation", "Choose a reason.", { field: "reasonCode" });
  const r = (await categoryRows(q, organizationId, category)).find((x) => x.code === c);
  if (!r) throw new DomainError("validation", "Choose a reason from the list.", { field: "reasonCode" });
  if (!r.isActive) throw new DomainError("validation", `Reason "${r.name}" is no longer in use. Choose another reason.`, { field: "reasonCode" });
  const n = (note ?? "").trim();
  if (n.length > REASON_NOTE_MAX) throw new DomainError("validation", `Keep the note to ${REASON_NOTE_MAX} characters.`, { field: "reasonNote" });
  if (r.requiresNote && !n) throw new DomainError("validation", `Add a note: the reason "${r.name}" needs an explanation.`, { field: "reasonNote" });
  return { code: r.code, name: r.name, requiresNote: r.requiresNote, requiresApproval: r.requiresApproval, note: n || null };
}

/** `opts.tx`: run inside a caller's transaction (savepoint), e.g. an import chunk (W3C, src/lib/tx.ts). */
export async function createReasonCode(ctx: AuthContext, raw: unknown, opts?: InTx) {
  ctx.require("masterdata.reason_code.admin");
  const v = parseInput(ReasonCodeCreate, raw);
  return runInTx(opts, async (tx) => {
    const code = v.code ?? (await codeFromName(v.name, "snake", 40, async (c) => (await tx.select({ id: reasonCodes.id }).from(reasonCodes).where(and(eq(reasonCodes.organizationId, ctx.organizationId), eq(reasonCodes.code, c))).limit(1)).length > 0));
    const [r] = await tx
      .insert(reasonCodes)
      .values({ organizationId: ctx.organizationId, ...v, code, sortOrder: v.sortOrder ?? 100, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
      .catch((e) => uniqueConflict(e, `Reason code ${code} already exists.`));
    await audit(tx, ctx, { action: "masterdata.reason_code.created", entityType: "reason_code", entityId: r.id, entityNumber: r.code, siteId: null, after: { ...v, code, codeAssigned: !v.code } });
    return r;
  });
}

/** Edits label, categories, flags and active state; the code itself never changes. Audited with before/after. */
export async function updateReasonCode(ctx: AuthContext, id: string, raw: unknown) {
  ctx.require("masterdata.reason_code.admin");
  assertUuid(id, "Reason code");
  const v = parseInput(ReasonCodeUpdate, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(reasonCodes).where(and(eq(reasonCodes.id, id), eq(reasonCodes.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Reason code not found.");
    const [after] = await tx
      .update(reasonCodes)
      .set({ ...v, sortOrder: v.sortOrder ?? before.sortOrder, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(reasonCodes.id, id))
      .returning();
    const d = diff(before, after, ["name", "description", "appliesTo", "requiresNote", "requiresApproval", "sortOrder", "isActive"]);
    if (d.changed.length) {
      await audit(tx, ctx, { action: "masterdata.reason_code.updated", entityType: "reason_code", entityId: after.id, entityNumber: after.code, siteId: null, before: d.before, after: d.after });
    }
    return after;
  });
}
