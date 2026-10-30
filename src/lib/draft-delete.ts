import "server-only";
import { and, eq, like, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { isReferenced } from "@/lib/references";

/**
 * Deleting a draft that was never submitted (ADR-075, owner request "I cannot delete drafts").
 *
 * Rules shared by every module:
 * 1. Only a never-submitted draft is deleted. Submitted, approved, posted or cancelled records
 *    are never deleted (they keep cancel / void / reversal as before). The caller checks the
 *    record's own state; this helper refuses when anything else references the row.
 * 2. Who: the person who created it (holding the create permission), or anyone holding the
 *    module's edit or admin permission. Site-bound records check the permission at the site.
 * 3. Hard delete of the row and of its own child rows (lines, addresses, transitions), in the
 *    caller's transaction, with `<module>.<entity>.deleted` in the audit trail carrying the deleted
 *    row in `before`.
 */

export type DeletePermissions = {
  /** The creator may delete their own draft when they hold this permission. */
  create?: Permission;
  /** Holders of any of these may delete anyone's draft. */
  manage: Permission[];
};

/** The user who created the record: the row's `created_by` when it has one, else the `*.created` audit event. */
export async function creatorOf(q: DbOrTx, organizationId: string, entityType: string, entityId: string, createdBy?: string | null): Promise<string | null> {
  if (createdBy) return createdBy;
  const [e] = await q
    .select({ actorId: auditEvents.actorId })
    .from(auditEvents)
    .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId), like(auditEvents.action, "%.created")))
    .orderBy(auditEvents.occurredAt)
    .limit(1);
  return e?.actorId ?? null;
}

/** Throws forbidden unless the caller may delete this draft (rule 2). Site scope first (404). */
export function assertMayDeleteDraft(ctx: AuthContext, perms: DeletePermissions, creatorId: string | null, siteId: string | null): void {
  ctx.assertWritable();
  if (siteId) ctx.requireSite(siteId);
  const has = (p: Permission) => (siteId ? ctx.canAt(p, siteId) : ctx.can(p));
  const manage = perms.manage.find(has);
  if (manage) {
    if (siteId) ctx.requireAt(manage, siteId);
    else ctx.require(manage);
    return;
  }
  if (perms.create && creatorId === ctx.userId && has(perms.create)) {
    if (siteId) ctx.requireAt(perms.create, siteId);
    else ctx.require(perms.create);
    return;
  }
  const p = perms.manage[0];
  throw new DomainError("forbidden", "Only the person who made this draft, or someone who may edit these records, can delete it.", { permission: p, ...(siteId ? { siteId } : {}) });
}

/** Refuses unless the record is a draft that was never submitted. */
export function assertNeverSubmittedDraft(what: string, isDraft: boolean, submittedAt?: Date | null): void {
  if (!isDraft) throw new DomainError("state", `${what} is no longer a draft, so it cannot be deleted. Cancel or void it instead.`, { code: "NOT_A_DRAFT" });
  if (submittedAt) throw new DomainError("state", `${what} was already sent for approval once, so it is kept. Cancel or void it instead.`, { code: "NOT_A_DRAFT" });
}

const TABLE_LABELS: Record<string, string> = {
  inventory_lots: "lots",
  stock_movements: "stock movements",
  purchase_order_lines: "purchase orders",
  purchase_request_lines: "purchase requests",
  sales_order_lines: "sales orders",
  bom_lines: "formulas",
  batches: "batches",
  work_orders: "work orders",
  goods_receipt_lines: "goods receipts",
  goods_receipts: "goods receipts",
  quotes: "quotations",
  quote_lines: "quotations",
  sales_orders: "sales orders",
  invoices: "invoices",
  price_list_lines: "price lists",
  supplier_materials: "approved-supplier list",
};
const nice = (t: string) => TABLE_LABELS[t] ?? t.replace(/_/g, " ");

export type HardDeleteSpec = {
  /** SQL table of the record. */
  table: string;
  id: string;
  /** "Material MAT-0001" (messages). */
  what: string;
  /**
   * Child tables deleted first, in order, by their foreign-key column to the record. With `through`,
   * the rows belong to a child table (e.g. step parameters of the revision's steps).
   */
  children?: { table: string; column: string; through?: { table: string; column: string } }[];

  /** Other tables that may reference the row without counting as "use" (e.g. a revision chain). */
  ignore?: string[];
  audit: { action: `${string}.${string}.${string}`; entityType: string; entityNumber: string | null; siteId: string | null; before: Record<string, unknown> };
};

function fkViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return code === "23503";
}

/**
 * Deletes the record and its own child rows inside `tx` and writes the audit event (rule 3).
 * Refuses with a plain message when another record points at it; a foreign key that still
 * fails at delete time (a child row in use) is reported the same way.
 */
export async function hardDeleteDraft(tx: DbOrTx, ctx: AuthContext, spec: HardDeleteSpec): Promise<void> {
  const children = spec.children ?? [];
  const ref = await isReferenced(tx, spec.table, spec.id, [...children.filter((c) => !c.through).map((c) => c.table), ...(spec.ignore ?? [])]);
  if (ref.referenced) {
    throw new DomainError("state", `${spec.what} is already used by ${[...new Set(ref.by.map(nice))].slice(0, 3).join(", ")}, so it cannot be deleted. Deactivate or cancel it instead.`, { code: "IN_USE", by: ref.by });
  }
  const counts: Record<string, number> = {};
  // Lets the creation row of an append-only transition history go with its draft (src/db/sql/s3.sql).
  await tx.execute(sql`select set_config('bc.draft_delete', 'on', true)`);
  try {
    for (const c of children) {
      const rows = c.through
        ? await tx.execute(sql`delete from ${sql.identifier(c.table)} where ${sql.identifier(c.column)} in (select id from ${sql.identifier(c.through.table)} where ${sql.identifier(c.through.column)} = ${spec.id}) returning 1`)
        : await tx.execute(sql`delete from ${sql.identifier(c.table)} where ${sql.identifier(c.column)} = ${spec.id} returning 1`);
      counts[c.table] = rows.length;
    }
    await tx.execute(sql`delete from ${sql.identifier(spec.table)} where id = ${spec.id}`);
  } catch (e) {
    if (fkViolation(e)) throw new DomainError("state", `${spec.what} is already used by another record, so it cannot be deleted. Deactivate or cancel it instead.`, { code: "IN_USE" });
    throw e;
  }
  await audit(tx, ctx, {
    action: spec.audit.action,
    entityType: spec.audit.entityType,
    entityId: spec.id,
    entityNumber: spec.audit.entityNumber,
    siteId: spec.audit.siteId,
    reason: "Draft deleted",
    before: { ...spec.audit.before, ...(Object.keys(counts).length ? { deletedChildRows: counts } : {}) },
  });
}
