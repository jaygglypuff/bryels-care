import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { customers, priceListLines, priceLists, products, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { notifyRoles } from "@/modules/platform";
import { approvalProgress, canDecide, decisionsOf, recordDecision, stepRoles } from "./crm-approvals";
import { businessDate, isUuid, money } from "./crm-support";

/**
 * Price lists with approval and masking (US-4-03; docs/data-model.md §3.7, §4; permissions-matrix §6).
 *
 * A list is identified by its `code`; every change is a new version:
 *   draft → pending_approval → approved → retired;  pending_approval → rejected | draft (returned).
 * Drafting needs `sales.price_list.edit`; approval follows `approval_rules` (document type
 * `price_list`, default: finance or owner_director) and is always by a different person than the
 * submitter and the last editor (mandatory SoD; CHECK on the table). An approved version becomes
 * effective on its `effective_from`; the previous approved version of the code is closed on that
 * date. Nobody without `sales.price_list.view` receives any of these rows (every query requires it).
 * Order and quote entry resolve the price from the customer's own list, else the general list.
 */

export type PriceListStatus = "draft" | "pending_approval" | "approved" | "rejected" | "retired";
export const PRICE_LIST_TRANSITIONS: Record<PriceListStatus, readonly PriceListStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "rejected", "draft"],
  approved: ["retired"],
  rejected: [],
  retired: [],
};

export function assertPriceListTransition(pl: { status: string; code: string; versionNo: number }, to: PriceListStatus) {
  if (!(PRICE_LIST_TRANSITIONS[pl.status as PriceListStatus] ?? []).includes(to)) {
    throw new DomainError("state", `Price list ${pl.code} v${pl.versionNo} is ${pl.status.replace(/_/g, " ")} and cannot become ${to.replace(/_/g, " ")}.`, { machine: "price_list", from: pl.status, to });
  }
}

export type PriceLineInput = { productId: string; minQtyUnits?: string | null; unitAmount: string };
export type PriceListInput = {
  code: string;
  name: string;
  partyKind: "customer" | "general";
  customerId?: string | null;
  currency?: string;
  effectiveFrom: string;
  changeSummary?: string | null;
  lines: PriceLineInput[];
};

const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,9}$/;

function validateLines(lines: PriceLineInput[]) {
  if (lines.length === 0) throw new DomainError("validation", "Add at least one product price.", { field: "lines" });
  if (lines.length > 500) throw new DomainError("validation", "At most 500 lines per list.", { field: "lines" });
  const fieldErrors: Record<string, string> = {};
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (!isUuid(l.productId)) fieldErrors[`lines.${i}.productId`] = "Choose a product.";
    if (!AMOUNT_RE.test(l.unitAmount?.trim() ?? "")) fieldErrors[`lines.${i}.unitAmount`] = "Price in pesos, up to 2 decimals.";
    const q = (l.minQtyUnits ?? "0").trim() || "0";
    if (!QTY_RE.test(q)) fieldErrors[`lines.${i}.minQtyUnits`] = "Whole pieces.";
    const key = `${l.productId}|${Number(q)}`;
    if (seen.has(key)) fieldErrors[`lines.${i}.minQtyUnits`] = "This product already has a price from this quantity.";
    seen.add(key);
  });
  if (Object.keys(fieldErrors).length) throw new DomainError("validation", "Check the highlighted prices.", { fieldErrors });
  return lines.map((l) => ({ productId: l.productId, minQtyUnits: String(Number((l.minQtyUnits ?? "0").trim() || "0")), unitAmount: new Decimal(l.unitAmount.trim()).toFixed(2) }));
}

export async function listPriceLists(ctx: AuthContext, filters: { customerId?: string; status?: string } = {}) {
  ctx.require("sales.price_list.view");
  const where = [eq(priceLists.organizationId, ctx.organizationId)];
  if (filters.customerId && isUuid(filters.customerId)) where.push(eq(priceLists.customerId, filters.customerId));
  if (filters.status) where.push(eq(priceLists.status, filters.status));
  const rows = await db
    .select({ pl: priceLists, customerName: customers.name, customerCode: customers.code })
    .from(priceLists)
    .leftJoin(customers, eq(customers.id, priceLists.customerId))
    .where(and(...where))
    .orderBy(asc(priceLists.code), desc(priceLists.versionNo));
  const counts = rows.length
    ? await db.select({ id: priceListLines.priceListId }).from(priceListLines).where(inArray(priceListLines.priceListId, rows.map((r) => r.pl.id)))
    : [];
  const today = businessDate();
  return rows.map((r) => ({
    ...r.pl,
    customerName: r.customerName,
    customerCode: r.customerCode,
    lineCount: counts.filter((c) => c.id === r.pl.id).length,
    effective: r.pl.status === "approved" && r.pl.effectiveFrom <= today && (r.pl.effectiveTo === null || r.pl.effectiveTo > today),
  }));
}

async function loadList(q: DbOrTx, ctx: AuthContext, id: string, lock = false) {
  if (!isUuid(id)) throw new DomainError("not_found", "Price list not found.");
  const base = q.select().from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.organizationId, ctx.organizationId))).limit(1);
  const [pl] = lock ? await base.for("update") : await base;
  if (!pl) throw new DomainError("not_found", "Price list not found.");
  return pl;
}

export async function getPriceList(ctx: AuthContext, id: string) {
  ctx.require("sales.price_list.view");
  const pl = await loadList(db, ctx, id);
  const [lines, versions, decisions, cust] = await Promise.all([
    db
      .select({ l: priceListLines, sku: products.skuCode, productName: products.name })
      .from(priceListLines)
      .innerJoin(products, eq(products.id, priceListLines.productId))
      .where(eq(priceListLines.priceListId, pl.id))
      .orderBy(asc(products.skuCode), asc(priceListLines.minQtyUnits)),
    db
      .select({ id: priceLists.id, versionNo: priceLists.versionNo, status: priceLists.status, effectiveFrom: priceLists.effectiveFrom, effectiveTo: priceLists.effectiveTo, approvedAt: priceLists.approvedAt })
      .from(priceLists)
      .where(and(eq(priceLists.organizationId, ctx.organizationId), eq(priceLists.code, pl.code)))
      .orderBy(desc(priceLists.versionNo)),
    decisionsOf(db, ctx.organizationId, "price_list", pl.id),
    pl.customerId ? db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.id, pl.customerId)).limit(1) : Promise.resolve([]),
  ]);
  const people = await db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, [pl.createdBy, pl.updatedBy, pl.submittedBy, pl.approvedBy].filter((x): x is string => !!x)));
  const name = (u: string | null) => (u ? (people.find((p) => p.id === u)?.name ?? "") : null);
  const progress = pl.status === "pending_approval" ? await approvalProgress(db, ctx.organizationId, { recordType: "price_list", recordId: pl.id, siteId: null, basis: {}, requesterIds: [pl.submittedBy, pl.updatedBy, pl.createdBy] }) : null;
  return {
    priceList: { ...pl, createdByName: name(pl.createdBy), updatedByName: name(pl.updatedBy), submittedByName: name(pl.submittedBy), approvedByName: name(pl.approvedBy) },
    customer: cust[0] ?? null,
    lines: lines.map((r) => ({ ...r.l, sku: r.sku, productName: r.productName })),
    versions,
    decisions,
    approval: progress,
    canApprove: progress ? canDecide(ctx, "price_list", progress.next, pl.submittedAt, [pl.submittedBy, pl.updatedBy, pl.createdBy], true) : false,
  };
}

async function insertLines(tx: Tx, priceListId: string, currency: string, lines: ReturnType<typeof validateLines>) {
  await tx.insert(priceListLines).values(lines.map((l) => ({ priceListId, productId: l.productId, minQtyUnits: l.minQtyUnits, unitAmount: l.unitAmount, currency })));
}

async function assertProducts(tx: Tx, ctx: AuthContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, unique), eq(products.organizationId, ctx.organizationId)));
  if (rows.length !== unique.length) throw new DomainError("validation", "One of the products was not found.", { field: "lines" });
}

/** Creates version 1 of a new list, or the next draft version of an existing code (no open version allowed). */
export async function createPriceList(ctx: AuthContext, input: PriceListInput) {
  ctx.require("sales.price_list.edit");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)) throw new DomainError("validation", "Code: 2–30 letters, digits or dashes.", { field: "code" });
  if (input.name.trim().length < 3) throw new DomainError("validation", "Enter a name.", { field: "name" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new DomainError("validation", "Choose the effective date.", { field: "effectiveFrom" });
  if (input.partyKind === "customer" && !isUuid(input.customerId)) throw new DomainError("validation", "Choose the customer.", { field: "customerId" });
  const lines = validateLines(input.lines);
  return db.transaction(async (tx) => {
    if (input.partyKind === "customer") {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId!), eq(customers.organizationId, ctx.organizationId))).limit(1);
      if (!c) throw new DomainError("validation", "Choose the customer.", { field: "customerId" });
    }
    await assertProducts(tx, ctx, lines.map((l) => l.productId));
    const existing = await tx.select().from(priceLists).where(and(eq(priceLists.organizationId, ctx.organizationId), eq(priceLists.code, code))).orderBy(desc(priceLists.versionNo)).for("update");
    if (existing.some((v) => v.status === "draft" || v.status === "pending_approval")) throw new DomainError("conflict", `Price list ${code} already has a draft or pending version.`, { field: "code" });
    if (existing[0] && (existing[0].partyKind !== input.partyKind || existing[0].customerId !== (input.customerId || null))) {
      throw new DomainError("conflict", `Code ${code} is used by another list. Choose a different code.`, { field: "code" });
    }
    const prev = existing.find((v) => v.status === "approved");
    const [pl] = await tx
      .insert(priceLists)
      .values({
        organizationId: ctx.organizationId,
        code,
        name: input.name.trim(),
        partyKind: input.partyKind,
        customerId: input.partyKind === "customer" ? input.customerId! : null,
        currency: input.currency ?? "PHP",
        versionNo: (existing[0]?.versionNo ?? 0) + 1,
        status: "draft",
        effectiveFrom: input.effectiveFrom,
        supersedesId: prev?.id ?? null,
        changeSummary: input.changeSummary?.trim() || null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await insertLines(tx, pl.id, pl.currency, lines);
    await audit(tx, ctx, { action: "sales.price_list.changed", entityType: "price_list", entityId: pl.id, entityNumber: `${code} v${pl.versionNo}`, siteId: null, after: { ...pl, lines } });
    return pl;
  });
}

/** Starts the next draft version from an approved one (copies its lines). */
export async function newPriceListVersion(ctx: AuthContext, fromId: string, effectiveFrom: string) {
  ctx.require("sales.price_list.edit");
  const src = await getPriceList(ctx, fromId);
  return createPriceList(ctx, {
    code: src.priceList.code,
    name: src.priceList.name,
    partyKind: src.priceList.partyKind as "customer" | "general",
    customerId: src.priceList.customerId,
    currency: src.priceList.currency,
    effectiveFrom,
    changeSummary: null,
    lines: src.lines.map((l) => ({ productId: l.productId, minQtyUnits: String(Number(l.minQtyUnits)), unitAmount: new Decimal(l.unitAmount).toFixed(2) })),
  });
}

/** Edits a draft version (name, date, summary and all lines). */
export async function updatePriceListDraft(ctx: AuthContext, id: string, input: Pick<PriceListInput, "name" | "effectiveFrom" | "changeSummary" | "lines">) {
  ctx.require("sales.price_list.edit");
  const lines = validateLines(input.lines);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new DomainError("validation", "Choose the effective date.", { field: "effectiveFrom" });
  return db.transaction(async (tx) => {
    const pl = await loadList(tx, ctx, id, true);
    if (pl.status !== "draft") throw new DomainError("state", `Price list ${pl.code} v${pl.versionNo} is ${pl.status.replace(/_/g, " ")}. Only a draft can be changed; start a new version to change approved prices.`);
    await assertProducts(tx, ctx, lines.map((l) => l.productId));
    const beforeLines = await tx.select().from(priceListLines).where(eq(priceListLines.priceListId, id));
    await tx.delete(priceListLines).where(eq(priceListLines.priceListId, id));
    await insertLines(tx, id, pl.currency, lines);
    await tx.update(priceLists).set({ name: input.name.trim(), effectiveFrom: input.effectiveFrom, changeSummary: input.changeSummary?.trim() || null, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(priceLists.id, id));
    await audit(tx, ctx, {
      action: "sales.price_list.changed",
      entityType: "price_list",
      entityId: id,
      entityNumber: `${pl.code} v${pl.versionNo}`,
      siteId: null,
      before: { name: pl.name, effectiveFrom: pl.effectiveFrom, lines: beforeLines.map((l) => ({ productId: l.productId, minQtyUnits: l.minQtyUnits, unitAmount: l.unitAmount })) },
      after: { name: input.name.trim(), effectiveFrom: input.effectiveFrom, lines },
    });
  });
}

export async function submitPriceList(ctx: AuthContext, id: string) {
  ctx.require("sales.price_list.edit");
  return db.transaction(async (tx) => {
    const pl = await loadList(tx, ctx, id, true);
    assertPriceListTransition(pl, "pending_approval");
    const now = new Date();
    await tx.update(priceLists).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: now, updatedAt: now }).where(eq(priceLists.id, id));
    await audit(tx, ctx, { action: "sales.price_list.submitted", entityType: "price_list", entityId: id, entityNumber: `${pl.code} v${pl.versionNo}`, siteId: null, before: { status: pl.status }, after: { status: "pending_approval" } });
    const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "price_list", recordId: id, siteId: null, basis: {} });
    const roles = stepRoles(progress.next);
    if (roles.length) {
      await notifyRoles(tx, { roleCodes: roles }, {
        organizationId: ctx.organizationId,
        kind: "approval_requested",
        severity: "info",
        title: `Price list ${pl.code} v${pl.versionNo} needs approval`,
        body: `${ctx.displayName} submitted ${pl.name} (effective ${pl.effectiveFrom}).`,
        entityType: "price_list",
        entityId: id,
        link: `/sales/price-lists/${id}`,
      });
    }
  });
}

/**
 * Approves a pending version (US-4-03 AC1): rule step check, approver ≠ submitter and ≠ last editor,
 * decision recorded; at the final step the version becomes approved and the previous approved
 * version of the code ends on the new effective date. Writes `sales.price_list.approved`.
 */
export async function approvePriceList(ctx: AuthContext, id: string, note?: string | null) {
  ctx.require("sales.price_list.approve");
  return db.transaction(async (tx) => {
    const pl = await loadList(tx, ctx, id, true);
    assertPriceListTransition(pl, "approved");
    const r = await recordDecision(tx, ctx, {
      recordType: "price_list",
      recordId: pl.id,
      recordNumber: `${pl.code} v${pl.versionNo}`,
      siteId: null,
      basis: {},
      pendingSince: pl.submittedAt,
      excludedUserIds: [pl.submittedBy, pl.updatedBy, pl.createdBy],
      sod: true,
      decision: "approved",
      note,
    });
    if (!r.final) {
      await audit(tx, ctx, { action: "sales.price_list.step_approved", entityType: "price_list", entityId: id, entityNumber: `${pl.code} v${pl.versionNo}`, siteId: null, after: { step: r.step?.step } });
      return { approved: false };
    }
    const others = await tx
      .select()
      .from(priceLists)
      .where(and(eq(priceLists.organizationId, ctx.organizationId), eq(priceLists.code, pl.code), eq(priceLists.status, "approved"), or(isNull(priceLists.effectiveTo), gt(priceLists.effectiveTo, pl.effectiveFrom))));
    const superseded: number[] = [];
    for (const o of others) {
      if (o.effectiveFrom >= pl.effectiveFrom) throw new DomainError("conflict", `Version ${o.versionNo} is already approved from ${o.effectiveFrom}. Choose a later effective date or retire it first.`);
      await tx.update(priceLists).set({ effectiveTo: pl.effectiveFrom, updatedAt: new Date() }).where(eq(priceLists.id, o.id));
      superseded.push(o.versionNo);
    }
    const now = new Date();
    await tx.update(priceLists).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: note?.trim() || null, updatedAt: now }).where(eq(priceLists.id, id));
    await audit(tx, ctx, {
      action: "sales.price_list.approved",
      entityType: "price_list",
      entityId: id,
      entityNumber: `${pl.code} v${pl.versionNo}`,
      siteId: null,
      before: { status: pl.status, versionNo: pl.versionNo },
      after: { status: "approved", versionNo: pl.versionNo, effectiveFrom: pl.effectiveFrom, supersededVersions: superseded },
    });
    return { approved: true };
  });
}

export async function rejectPriceList(ctx: AuthContext, id: string, reason: string, opts: { returnToDraft?: boolean } = {}) {
  ctx.require("sales.price_list.approve");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const pl = await loadList(tx, ctx, id, true);
    const to: PriceListStatus = opts.returnToDraft ? "draft" : "rejected";
    assertPriceListTransition(pl, to);
    await recordDecision(tx, ctx, {
      recordType: "price_list",
      recordId: pl.id,
      recordNumber: `${pl.code} v${pl.versionNo}`,
      siteId: null,
      basis: {},
      pendingSince: pl.submittedAt,
      excludedUserIds: [pl.submittedBy, pl.updatedBy, pl.createdBy],
      sod: true,
      decision: opts.returnToDraft ? "returned" : "rejected",
      note: reason,
    });
    await tx.update(priceLists).set({ status: to, approvalNote: reason.trim(), updatedAt: new Date() }).where(eq(priceLists.id, id));
    await audit(tx, ctx, { action: opts.returnToDraft ? "sales.price_list.returned" : "sales.price_list.rejected", entityType: "price_list", entityId: id, entityNumber: `${pl.code} v${pl.versionNo}`, siteId: null, reason: reason.trim(), before: { status: pl.status }, after: { status: to } });
  });
}

export async function retirePriceList(ctx: AuthContext, id: string, reason: string) {
  ctx.require("sales.price_list.approve");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const pl = await loadList(tx, ctx, id, true);
    assertPriceListTransition(pl, "retired");
    await tx.update(priceLists).set({ status: "retired", updatedAt: new Date() }).where(eq(priceLists.id, id));
    await audit(tx, ctx, { action: "sales.price_list.retired", entityType: "price_list", entityId: id, entityNumber: `${pl.code} v${pl.versionNo}`, siteId: null, reason: reason.trim(), before: { status: pl.status }, after: { status: "retired" } });
  });
}

/* ------------------------------------------------------------------ resolution */

export type ResolvedPrice = { priceListId: string; priceListCode: string; priceListLineId: string; unitAmount: string; currency: string; partyKind: string };

/**
 * The agreed price of a product for a customer, quantity and date: the customer's approved effective
 * list first, else the general list; within a list the highest quantity break not above the quantity.
 * Internal (no permission): callers mask the result for users without `sales.price_list.view`.
 */
export async function resolvePrice(q: DbOrTx, organizationId: string, customerId: string, productId: string, qty: Decimal.Value, on = businessDate()): Promise<ResolvedPrice | null> {
  const rows = await q
    .select({ pl: priceLists, line: priceListLines })
    .from(priceLists)
    .innerJoin(priceListLines, eq(priceListLines.priceListId, priceLists.id))
    .where(
      and(
        eq(priceLists.organizationId, organizationId),
        eq(priceLists.status, "approved"),
        lte(priceLists.effectiveFrom, on),
        or(isNull(priceLists.effectiveTo), gt(priceLists.effectiveTo, on)),
        or(eq(priceLists.customerId, customerId), eq(priceLists.partyKind, "general")),
        eq(priceListLines.productId, productId),
      ),
    );
  const n = new Decimal(qty || 0);
  const pick = (kind: "customer" | "general") =>
    rows
      .filter((r) => r.pl.partyKind === kind && new Decimal(r.line.minQtyUnits).lte(n))
      .sort((a, b) => new Decimal(b.line.minQtyUnits).cmp(a.line.minQtyUnits) || b.pl.effectiveFrom.localeCompare(a.pl.effectiveFrom))[0];
  const hit = pick("customer") ?? pick("general");
  if (!hit) return null;
  return { priceListId: hit.pl.id, priceListCode: hit.pl.code, priceListLineId: hit.line.id, unitAmount: money(hit.line.unitAmount), currency: hit.line.currency, partyKind: hit.pl.partyKind };
}

/** Prices for order/quote entry: per product, the price breaks in force for the customer today. */
export async function priceBook(ctx: AuthContext, customerId: string, on = businessDate()) {
  ctx.require("sales.price_list.view");
  const rows = await db
    .select({ pl: priceLists, line: priceListLines })
    .from(priceLists)
    .innerJoin(priceListLines, eq(priceListLines.priceListId, priceLists.id))
    .where(
      and(
        eq(priceLists.organizationId, ctx.organizationId),
        eq(priceLists.status, "approved"),
        lte(priceLists.effectiveFrom, on),
        or(isNull(priceLists.effectiveTo), gt(priceLists.effectiveTo, on)),
        or(eq(priceLists.customerId, customerId), eq(priceLists.partyKind, "general")),
      ),
    );
  const byProduct = new Map<string, { minQtyUnits: string; unitAmount: string; code: string; kind: string }[]>();
  const customerProducts = new Set(rows.filter((r) => r.pl.partyKind === "customer").map((r) => r.line.productId));
  for (const r of rows) {
    // The customer's own list replaces the general list for a product it prices.
    if (r.pl.partyKind === "general" && customerProducts.has(r.line.productId)) continue;
    const list = byProduct.get(r.line.productId) ?? [];
    list.push({ minQtyUnits: r.line.minQtyUnits, unitAmount: money(r.line.unitAmount), code: r.pl.code, kind: r.pl.partyKind });
    byProduct.set(r.line.productId, list);
  }
  for (const list of byProduct.values()) list.sort((a, b) => new Decimal(a.minQtyUnits).cmp(b.minQtyUnits));
  return Object.fromEntries(byProduct);
}

/** Options for the price list form (customers and active products). */
export async function priceListFormOptions(ctx: AuthContext) {
  ctx.require("sales.price_list.edit");
  const [custs, prods] = await Promise.all([
    db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.organizationId, ctx.organizationId)).orderBy(asc(customers.name)),
    db.select({ id: products.id, skuCode: products.skuCode, name: products.name }).from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.status, "active"))).orderBy(asc(products.skuCode)),
  ]);
  return { customers: custs, products: prods };
}

/** Price lists waiting for the caller's approval (approval queue badge). */
export async function pendingPriceListCount(ctx: AuthContext) {
  if (!ctx.can("sales.price_list.approve")) return 0;
  const rows = await db.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.organizationId, ctx.organizationId), eq(priceLists.status, "pending_approval")));
  return rows.length;
}

/**
 * Deletes a price list version that is a never-submitted draft (ADR-075), with its lines. Creator
 * or another holder of sales.price_list.edit (price lists are organization-wide). Audit
 * sales.price_list.deleted. Returns the version it was copied from, if any.
 */
export async function deleteDraftPriceList(ctx: AuthContext, id: string): Promise<{ previousId: string | null }> {
  return db.transaction(async (tx) => {
    const pl = await loadList(tx, ctx, id, true);
    const what = `Price list ${pl.code} v${pl.versionNo}`;
    assertMayDeleteDraft(ctx, { manage: ["sales.price_list.edit"] }, pl.createdBy, null);
    assertNeverSubmittedDraft(what, pl.status === "draft", pl.submittedAt);
    const lines = await tx.select().from(priceListLines).where(eq(priceListLines.priceListId, pl.id));
    await hardDeleteDraft(tx, ctx, {
      table: "price_lists",
      id: pl.id,
      what,
      children: [{ table: "price_list_lines", column: "price_list_id" }],
      audit: { action: "sales.price_list.deleted", entityType: "price_list", entityNumber: `${pl.code} v${pl.versionNo}`, siteId: null, before: { ...pl, lines } },
    });
    return { previousId: pl.supersedesId ?? null };
  });
}
