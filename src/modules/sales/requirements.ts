import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, or, gt, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { REQUIREMENT_KINDS, artworkVersions, customerItemCodes, customerRequirements, customers, labelTemplates, products, skus, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { businessDate, isUuid } from "./crm-support";

/**
 * Customer requirements and SKU packaging configuration (US-4-02; docs/data-model.md §3.2, §4).
 *
 * A requirement is versioned per parent (customer, product or all products, kind):
 *   draft → pending_approval → approved → retired;  pending_approval → rejected | draft (returned).
 * Only an `approved` version whose effective range contains the date applies; a product-specific
 * version beats the "all products" one. Approval needs `masterdata.customer_requirement.approve` and a
 * different person than the submitter (CHECK + service). Approving a version closes the previous
 * approved version of the same parent on the new effective date (superseded); an approved version
 * that starts on or after that date is a conflict. Orders snapshot the version ids they used.
 */

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type RequirementStatus = "draft" | "pending_approval" | "approved" | "rejected" | "retired";

export const REQUIREMENT_TRANSITIONS: Record<RequirementStatus, readonly RequirementStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "rejected", "draft"],
  approved: ["retired"],
  rejected: [],
  retired: [],
};

export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  label_artwork: "Label artwork version",
  carton_count: "Units per carton",
  coa_required: "Certificate of analysis with each delivery",
  moq: "Minimum order quantity (pcs)",
  lead_time: "Lead time (days)",
  packaging: "Packaging instructions",
  document: "Required document",
  lot_age_max_days: "Maximum lot age at dispatch (days)",
  min_remaining_shelf_life_days: "Minimum remaining shelf life at dispatch (days)",
  full_shipment_required: "Full shipment required (no partials)",
  shipping_marks: "Shipping marks",
  other: "Other",
};

/** How the value of each kind is entered and stored. */
export const REQUIREMENT_VALUE: Record<RequirementKind, "number" | "boolean" | "text" | "artwork"> = {
  label_artwork: "artwork",
  carton_count: "number",
  coa_required: "boolean",
  moq: "number",
  lead_time: "number",
  packaging: "text",
  document: "text",
  lot_age_max_days: "number",
  min_remaining_shelf_life_days: "number",
  full_shipment_required: "boolean",
  shipping_marks: "text",
  other: "text",
};

type ReqRow = typeof customerRequirements.$inferSelect;

export function assertRequirementTransition(r: { status: string; versionNo: number }, to: RequirementStatus) {
  const allowed = REQUIREMENT_TRANSITIONS[r.status as RequirementStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("state", `Version ${r.versionNo} is ${r.status.replace(/_/g, " ")} and cannot become ${to.replace(/_/g, " ")}.`, { machine: "customer_requirement", from: r.status, to });
  }
}

function describeValue(r: Pick<ReqRow, "requirementKind" | "valueNumeric" | "valueText">, artwork?: { artworkCode: string; versionLabel: string } | null): string {
  const kind = r.requirementKind as RequirementKind;
  switch (REQUIREMENT_VALUE[kind]) {
    case "number":
      return r.valueNumeric === null ? "—" : String(Number(r.valueNumeric));
    case "boolean":
      return r.valueText === "true" ? "Yes" : "No";
    case "artwork":
      return artwork ? `${artwork.artworkCode} ${artwork.versionLabel}` : "—";
    default:
      return r.valueText ?? "—";
  }
}

async function loadCustomerOrg(q: DbOrTx, ctx: AuthContext, customerId: string) {
  if (!isUuid(customerId)) throw new DomainError("not_found", "Customer not found.");
  const [c] = await q.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
  if (!c) throw new DomainError("not_found", "Customer not found.");
  return c;
}

/** Every version of every requirement of a customer, newest first per parent. */
export async function listRequirements(ctx: AuthContext, customerId: string) {
  ctx.require("masterdata.customer_requirement.view");
  const c = await loadCustomerOrg(db, ctx, customerId);
  const rows = await db
    .select({ r: customerRequirements, sku: products.skuCode, productName: products.name, artworkCode: artworkVersions.artworkCode, versionLabel: artworkVersions.versionLabel, submittedByName: users.displayName })
    .from(customerRequirements)
    .leftJoin(products, eq(products.id, customerRequirements.productId))
    .leftJoin(artworkVersions, eq(artworkVersions.id, customerRequirements.artworkVersionId))
    .leftJoin(users, eq(users.id, customerRequirements.submittedBy))
    .where(eq(customerRequirements.customerId, c.id))
    .orderBy(asc(customerRequirements.requirementKind), asc(products.skuCode), desc(customerRequirements.versionNo));
  const today = businessDate();
  return rows.map(({ r, sku, productName, artworkCode, versionLabel, submittedByName }) => ({
    ...r,
    sku,
    productName,
    submittedByName,
    kindLabel: REQUIREMENT_KIND_LABEL[r.requirementKind as RequirementKind] ?? r.requirementKind,
    valueLabel: describeValue(r, artworkCode ? { artworkCode, versionLabel: versionLabel ?? "" } : null),
    effective: r.status === "approved" && r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo > today),
    scheduled: r.status === "approved" && r.effectiveFrom > today,
  }));
}

export type RequirementDraftInput = {
  customerId: string;
  productId?: string | null;
  requirementKind: RequirementKind;
  valueNumeric?: string | null;
  valueText?: string | null;
  artworkVersionId?: string | null;
  effectiveFrom: string;
  changeSummary?: string | null;
};

function normaliseValue(input: RequirementDraftInput) {
  const kind = input.requirementKind;
  if (!(REQUIREMENT_KINDS as readonly string[]).includes(kind)) throw new DomainError("validation", "Choose a requirement kind.", { field: "requirementKind" });
  const mode = REQUIREMENT_VALUE[kind];
  if (mode === "number") {
    const v = (input.valueNumeric ?? "").trim();
    if (!/^\d{1,9}$/.test(v)) throw new DomainError("validation", "Enter a whole number.", { field: "valueNumeric" });
    return { valueNumeric: v, valueText: null, artworkVersionId: null };
  }
  if (mode === "boolean") {
    const v = input.valueText === "true" ? "true" : input.valueText === "false" ? "false" : null;
    if (!v) throw new DomainError("validation", "Choose yes or no.", { field: "valueText" });
    return { valueNumeric: null, valueText: v, artworkVersionId: null };
  }
  if (mode === "artwork") {
    if (!isUuid(input.artworkVersionId)) throw new DomainError("validation", "Choose the artwork version.", { field: "artworkVersionId" });
    return { valueNumeric: null, valueText: null, artworkVersionId: input.artworkVersionId };
  }
  const t = (input.valueText ?? "").trim();
  if (t.length < 2 || t.length > 500) throw new DomainError("validation", "Describe the requirement (2–500 characters).", { field: "valueText" });
  return { valueNumeric: null, valueText: t, artworkVersionId: null };
}

/**
 * Drafts a new version of a requirement (version_no = last + 1). Only one draft or pending version
 * per parent exists at a time.
 */
export async function draftRequirement(ctx: AuthContext, input: RequirementDraftInput) {
  ctx.require("masterdata.customer_requirement.create");
  const value = normaliseValue(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new DomainError("validation", "Choose the effective date.", { field: "effectiveFrom" });
  return db.transaction(async (tx) => {
    const c = await loadCustomerOrg(tx, ctx, input.customerId);
    // Serialize versions of one customer's requirements on the customer row.
    await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id)).for("update");
    if (input.productId) {
      const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
      if (!p) throw new DomainError("validation", "Choose a product.", { field: "productId" });
    }
    if (value.artworkVersionId) {
      const [a] = await tx.select().from(artworkVersions).where(and(eq(artworkVersions.id, value.artworkVersionId), eq(artworkVersions.organizationId, ctx.organizationId))).limit(1);
      if (!a || a.status !== "active") throw new DomainError("validation", "Choose an active artwork version.", { field: "artworkVersionId" });
      if (a.customerId && a.customerId !== c.id) throw new DomainError("validation", "That artwork belongs to another customer.", { field: "artworkVersionId" });
      if (input.productId && a.productId !== input.productId) throw new DomainError("validation", "That artwork is for another product.", { field: "artworkVersionId" });
    }
    const parent = and(
      eq(customerRequirements.customerId, c.id),
      eq(customerRequirements.requirementKind, input.requirementKind),
      input.productId ? eq(customerRequirements.productId, input.productId) : isNull(customerRequirements.productId),
    );
    const versions = await tx.select().from(customerRequirements).where(parent).orderBy(desc(customerRequirements.versionNo));
    if (versions.some((v) => v.status === "draft" || v.status === "pending_approval")) {
      throw new DomainError("conflict", "A draft or pending version of this requirement already exists. Finish or withdraw it first.");
    }
    const prev = versions.find((v) => v.status === "approved");
    const [row] = await tx
      .insert(customerRequirements)
      .values({
        organizationId: ctx.organizationId,
        customerId: c.id,
        productId: input.productId || null,
        requirementKind: input.requirementKind,
        ...value,
        versionNo: (versions[0]?.versionNo ?? 0) + 1,
        status: "draft",
        effectiveFrom: input.effectiveFrom,
        supersedesId: prev?.id ?? null,
        changeSummary: input.changeSummary?.trim() || null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "masterdata.customer_requirement.created", entityType: "customer_requirement", entityId: row.id, entityNumber: `${c.code} ${input.requirementKind} v${row.versionNo}`, siteId: null, after: row });
    return row;
  });
}

async function lockRequirement(tx: Tx, ctx: AuthContext, id: string): Promise<ReqRow & { customerCode: string }> {
  if (!isUuid(id)) throw new DomainError("not_found", "Requirement not found.");
  const [r] = await tx
    .select({ r: customerRequirements, code: customers.code })
    .from(customerRequirements)
    .innerJoin(customers, eq(customers.id, customerRequirements.customerId))
    .where(and(eq(customerRequirements.id, id), eq(customerRequirements.organizationId, ctx.organizationId)))
    .limit(1);
  if (!r) throw new DomainError("not_found", "Requirement not found.");
  await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, r.r.customerId)).for("update");
  const [fresh] = await tx.select().from(customerRequirements).where(eq(customerRequirements.id, id)).for("update");
  return { ...fresh, customerCode: r.code };
}

const label = (r: { customerCode: string; requirementKind: string; versionNo: number }) => `${r.customerCode} ${r.requirementKind} v${r.versionNo}`;

export async function submitRequirement(ctx: AuthContext, id: string) {
  ctx.require("masterdata.customer_requirement.edit");
  return db.transaction(async (tx) => {
    const r = await lockRequirement(tx, ctx, id);
    assertRequirementTransition(r, "pending_approval");
    const now = new Date();
    await tx.update(customerRequirements).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: now, updatedBy: ctx.userId, updatedAt: now }).where(eq(customerRequirements.id, id));
    await audit(tx, ctx, { action: "masterdata.customer_requirement.submitted", entityType: "customer_requirement", entityId: id, entityNumber: label(r), siteId: null, before: { status: r.status, versionNo: r.versionNo }, after: { status: "pending_approval", versionNo: r.versionNo } });
  });
}

/** Approves a pending version (≠ submitter); the previous approved version is superseded on the effective date. */
export async function approveRequirement(ctx: AuthContext, id: string, note?: string | null) {
  ctx.require("masterdata.customer_requirement.approve");
  return db.transaction(async (tx) => {
    const r = await lockRequirement(tx, ctx, id);
    assertRequirementTransition(r, "approved");
    if (ctx.sodBlocksAt(r.submittedBy === ctx.userId || r.createdBy === ctx.userId, "You drafted or submitted this requirement, so another person must approve it.", null)) {
      throw new DomainError("separation_of_duties", "You drafted or submitted this requirement, so another person must approve it.", ctx.refusalDetails());
    }
    const parent = and(
      eq(customerRequirements.customerId, r.customerId),
      eq(customerRequirements.requirementKind, r.requirementKind),
      r.productId ? eq(customerRequirements.productId, r.productId) : isNull(customerRequirements.productId),
      eq(customerRequirements.status, "approved"),
      or(isNull(customerRequirements.effectiveTo), gt(customerRequirements.effectiveTo, r.effectiveFrom)),
    );
    const overlapping = await tx.select().from(customerRequirements).where(parent);
    const superseded: number[] = [];
    for (const o of overlapping) {
      if (o.effectiveFrom >= r.effectiveFrom) {
        throw new DomainError("conflict", `Version ${o.versionNo} is already approved from ${o.effectiveFrom}. Choose a later effective date, or retire it first.`);
      }
      await tx.update(customerRequirements).set({ effectiveTo: r.effectiveFrom, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(customerRequirements.id, o.id));
      superseded.push(o.versionNo);
    }
    const now = new Date();
    await tx.update(customerRequirements).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: note?.trim() || null, updatedBy: ctx.userId, updatedAt: now }).where(eq(customerRequirements.id, id));
    await audit(tx, ctx, {
      action: "masterdata.customer_requirement.approved",
      entityType: "customer_requirement",
      entityId: id,
      entityNumber: label(r),
      siteId: null,
      before: { status: r.status, versionNo: r.versionNo },
      after: { status: "approved", versionNo: r.versionNo, effectiveFrom: r.effectiveFrom, supersededVersions: superseded },
    });
  });
}

/** Rejects a pending version (reason required) or returns it to draft for changes. */
export async function rejectRequirement(ctx: AuthContext, id: string, reason: string, opts: { returnToDraft?: boolean } = {}) {
  ctx.require("masterdata.customer_requirement.approve");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const r = await lockRequirement(tx, ctx, id);
    const to: RequirementStatus = opts.returnToDraft ? "draft" : "rejected";
    assertRequirementTransition(r, to);
    await tx.update(customerRequirements).set({ status: to, approvalNote: reason.trim(), updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(customerRequirements.id, id));
    await audit(tx, ctx, { action: opts.returnToDraft ? "masterdata.customer_requirement.returned" : "masterdata.customer_requirement.rejected", entityType: "customer_requirement", entityId: id, entityNumber: label(r), siteId: null, reason: reason.trim(), before: { status: r.status, versionNo: r.versionNo }, after: { status: to, versionNo: r.versionNo } });
  });
}

/** Withdraws an approved version (it no longer applies to new orders; history keeps pointing at it). */
export async function retireRequirement(ctx: AuthContext, id: string, reason: string) {
  ctx.require("masterdata.customer_requirement.approve");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const r = await lockRequirement(tx, ctx, id);
    assertRequirementTransition(r, "retired");
    // A retired version is no longer `approved`, so resolution ignores it; its dates stay as history.
    await tx.update(customerRequirements).set({ status: "retired", updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(customerRequirements.id, id));
    await audit(tx, ctx, { action: "masterdata.customer_requirement.retired", entityType: "customer_requirement", entityId: id, entityNumber: label(r), siteId: null, reason: reason.trim(), before: { status: r.status, versionNo: r.versionNo }, after: { status: "retired", versionNo: r.versionNo } });
  });
}

/* ------------------------------------------------------------------ resolution */

export type EffectiveRequirement = { id: string; versionNo: number; kind: RequirementKind; productId: string | null; valueNumeric: string | null; valueText: string | null; artworkVersionId: string | null; labelTemplateId: string | null };

/**
 * The approved requirements in force for a customer and product on a date: per kind, the
 * product-specific version beats the all-products one. Used by order submission (snapshot), and
 * exposed for allocation and boxing (W3E) so they apply the same rules.
 */
export async function effectiveRequirements(q: DbOrTx, organizationId: string, customerId: string, productId: string | null, on = businessDate()): Promise<Partial<Record<RequirementKind, EffectiveRequirement>>> {
  const rows = await q
    .select()
    .from(customerRequirements)
    .where(
      and(
        eq(customerRequirements.organizationId, organizationId),
        eq(customerRequirements.customerId, customerId),
        eq(customerRequirements.status, "approved"),
        lte(customerRequirements.effectiveFrom, on),
        or(isNull(customerRequirements.effectiveTo), gt(customerRequirements.effectiveTo, on)),
        productId ? or(isNull(customerRequirements.productId), eq(customerRequirements.productId, productId)) : isNull(customerRequirements.productId),
      ),
    )
    .orderBy(desc(customerRequirements.effectiveFrom), desc(customerRequirements.versionNo));
  const out: Partial<Record<RequirementKind, EffectiveRequirement>> = {};
  for (const r of rows) {
    const kind = r.requirementKind as RequirementKind;
    const cur = out[kind];
    const better = !cur || (cur.productId === null && r.productId !== null);
    if (better) out[kind] = { id: r.id, versionNo: r.versionNo, kind, productId: r.productId, valueNumeric: r.valueNumeric, valueText: r.valueText, artworkVersionId: r.artworkVersionId, labelTemplateId: r.labelTemplateId };
  }
  return out;
}

/** Snapshot of the requirements applied to one order line (schema requirement_snapshot/v1). */
export async function requirementSnapshot(q: DbOrTx, organizationId: string, customerId: string, productId: string, defaultMinShelfLifeDays: number, on = businessDate()) {
  const eff = await effectiveRequirements(q, organizationId, customerId, productId, on);
  const num = (k: RequirementKind) => (eff[k]?.valueNumeric != null ? Number(eff[k]!.valueNumeric) : null);
  const minShelf = num("min_remaining_shelf_life_days") ?? defaultMinShelfLifeDays;
  return {
    schema: "requirement_snapshot/v1" as const,
    on,
    requirementIds: Object.values(eff).map((r) => r!.id),
    minRemainingShelfLifeDays: minShelf,
    moq: num("moq"),
    leadTimeDays: num("lead_time"),
    cartonCount: num("carton_count"),
    lotAgeMaxDays: num("lot_age_max_days"),
    coaRequired: eff.coa_required?.valueText === "true",
    fullShipmentRequired: eff.full_shipment_required?.valueText === "true",
    artworkVersionId: eff.label_artwork?.artworkVersionId ?? null,
    shippingMarks: eff.shipping_marks?.valueText ?? null,
    packaging: eff.packaging?.valueText ?? null,
    documents: eff.document?.valueText ?? null,
  };
}
export type RequirementSnapshot = Awaited<ReturnType<typeof requirementSnapshot>>;

/**
 * Packaging configuration for boxing a customer's product (US-4-02 AC1, A-PROC-22): the customer's
 * approved requirements override the SKU default; when the customer has no packaging requirement the
 * SKU (else product) default applies and `usedDefault` is true so the pack is flagged
 * "default config used" for sales review. Exposed for W3E (boxing / packing).
 */
export async function resolvePackagingConfig(q: DbOrTx, organizationId: string, customerId: string | null, productId: string, on = businessDate()) {
  const [p] = await q.select({ unitsPerBox: products.unitsPerBox, skuCode: products.skuCode }).from(products).where(and(eq(products.id, productId), eq(products.organizationId, organizationId))).limit(1);
  if (!p) throw new DomainError("not_found", "Product not found.");
  const [sku] = await q.select({ id: skus.id, unitsPerBox: skus.unitsPerBox }).from(skus).where(and(eq(skus.productId, productId), eq(skus.organizationId, organizationId), eq(skus.status, "active"))).limit(1);
  const eff = customerId ? await effectiveRequirements(q, organizationId, customerId, productId, on) : {};
  const carton = eff.carton_count?.valueNumeric != null ? Number(eff.carton_count.valueNumeric) : null;
  const artwork = eff.label_artwork?.artworkVersionId
    ? (await q.select().from(artworkVersions).where(eq(artworkVersions.id, eff.label_artwork.artworkVersionId)).limit(1))[0] ?? null
    : null;
  const labelTemplate = eff.label_artwork?.labelTemplateId
    ? (await q.select({ id: labelTemplates.id, code: labelTemplates.code }).from(labelTemplates).where(eq(labelTemplates.id, eff.label_artwork.labelTemplateId)).limit(1))[0] ?? null
    : null;
  const packagingKinds: RequirementKind[] = ["carton_count", "label_artwork", "packaging", "shipping_marks"];
  const used = packagingKinds.filter((k) => eff[k]);
  return {
    unitsPerBox: carton ?? sku?.unitsPerBox ?? p.unitsPerBox,
    unitsPerBoxSource: carton ? ("customer_requirement" as const) : sku?.unitsPerBox ? ("sku" as const) : ("product" as const),
    artwork: artwork ? { id: artwork.id, code: artwork.artworkCode, versionLabel: artwork.versionLabel } : null,
    labelTemplate,
    shippingMarks: eff.shipping_marks?.valueText ?? null,
    packaging: eff.packaging?.valueText ?? null,
    requirementIds: used.map((k) => eff[k]!.id),
    usedDefault: used.length === 0,
  };
}

/* ------------------------------------------------------------------ artwork versions and item codes */

export async function listArtworkVersions(ctx: AuthContext, customerId?: string | null) {
  ctx.require("masterdata.customer_requirement.view");
  const where = [eq(artworkVersions.organizationId, ctx.organizationId)];
  if (customerId) where.push(or(isNull(artworkVersions.customerId), eq(artworkVersions.customerId, customerId))!);
  return db
    .select({ a: artworkVersions, sku: products.skuCode, productName: products.name })
    .from(artworkVersions)
    .innerJoin(products, eq(products.id, artworkVersions.productId))
    .where(and(...where))
    .orderBy(asc(artworkVersions.artworkCode), desc(artworkVersions.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.a, sku: r.sku, productName: r.productName })));
}

export async function createArtworkVersion(ctx: AuthContext, input: { customerId?: string | null; productId: string; artworkCode: string; versionLabel: string; description?: string | null }) {
  ctx.require("masterdata.customer_requirement.create");
  const code = input.artworkCode.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(code)) throw new DomainError("validation", "Artwork code: 2–40 letters, digits, dot, dash or underscore.", { field: "artworkCode" });
  if (!input.versionLabel.trim() || input.versionLabel.trim().length > 20) throw new DomainError("validation", "Enter the version (e.g. v3).", { field: "versionLabel" });
  return db.transaction(async (tx) => {
    if (input.customerId) await loadCustomerOrg(tx, ctx, input.customerId);
    const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
    if (!p) throw new DomainError("validation", "Choose a product.", { field: "productId" });
    const [dup] = await tx.select({ id: artworkVersions.id }).from(artworkVersions).where(and(eq(artworkVersions.organizationId, ctx.organizationId), eq(artworkVersions.artworkCode, code), eq(artworkVersions.versionLabel, input.versionLabel.trim()))).limit(1);
    if (dup) throw new DomainError("conflict", `Artwork ${code} ${input.versionLabel.trim()} already exists.`, { field: "versionLabel" });
    const [row] = await tx
      .insert(artworkVersions)
      .values({ organizationId: ctx.organizationId, customerId: input.customerId || null, productId: p.id, artworkCode: code, versionLabel: input.versionLabel.trim(), description: input.description?.trim() || null, createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "masterdata.artwork_version.created", entityType: "artwork_version", entityId: row.id, entityNumber: `${code} ${row.versionLabel}`, siteId: null, after: row });
    return row;
  });
}

export async function retireArtworkVersion(ctx: AuthContext, id: string, reason: string) {
  ctx.require("masterdata.customer_requirement.edit");
  if (!reason?.trim()) throw new DomainError("validation", "Give a reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const [a] = isUuid(id) ? await tx.select().from(artworkVersions).where(and(eq(artworkVersions.id, id), eq(artworkVersions.organizationId, ctx.organizationId))).for("update") : [];
    if (!a) throw new DomainError("not_found", "Artwork version not found.");
    if (a.status !== "active") throw new DomainError("state", "This artwork version is already retired.");
    await tx.update(artworkVersions).set({ status: "retired", retiredBy: ctx.userId, retiredAt: new Date() }).where(eq(artworkVersions.id, id));
    await audit(tx, ctx, { action: "masterdata.artwork_version.retired", entityType: "artwork_version", entityId: id, entityNumber: `${a.artworkCode} ${a.versionLabel}`, siteId: null, reason: reason.trim(), before: { status: "active" }, after: { status: "retired" } });
  });
}

export async function listItemCodes(q: DbOrTx, customerId: string) {
  return q
    .select({ id: customerItemCodes.id, productId: customerItemCodes.productId, customerItemCode: customerItemCodes.customerItemCode, customerDescription: customerItemCodes.customerDescription, sku: products.skuCode, productName: products.name })
    .from(customerItemCodes)
    .innerJoin(products, eq(products.id, customerItemCodes.productId))
    .where(eq(customerItemCodes.customerId, customerId))
    .orderBy(asc(products.skuCode));
}

/** Maps the customer's own item code to one of our products (one code per product and customer). */
export async function setItemCode(ctx: AuthContext, input: { customerId: string; productId: string; customerItemCode: string; customerDescription?: string | null }) {
  ctx.require("masterdata.customer.edit");
  const code = input.customerItemCode.trim();
  if (code.length < 1 || code.length > 40) throw new DomainError("validation", "Enter the customer's item code (up to 40 characters).", { field: "customerItemCode" });
  return db.transaction(async (tx) => {
    const c = await loadCustomerOrg(tx, ctx, input.customerId);
    const [p] = await tx.select({ id: products.id, sku: products.skuCode }).from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
    if (!p) throw new DomainError("validation", "Choose a product.", { field: "productId" });
    const [clash] = await tx.select().from(customerItemCodes).where(and(eq(customerItemCodes.customerId, c.id), eq(customerItemCodes.customerItemCode, code))).limit(1);
    if (clash && clash.productId !== p.id) throw new DomainError("conflict", `${code} is already mapped to another product of this customer.`, { field: "customerItemCode" });
    const [before] = await tx.select().from(customerItemCodes).where(and(eq(customerItemCodes.customerId, c.id), eq(customerItemCodes.productId, p.id))).limit(1);
    const [row] = before
      ? await tx.update(customerItemCodes).set({ customerItemCode: code, customerDescription: input.customerDescription?.trim() || null }).where(eq(customerItemCodes.id, before.id)).returning()
      : await tx.insert(customerItemCodes).values({ organizationId: ctx.organizationId, customerId: c.id, productId: p.id, customerItemCode: code, customerDescription: input.customerDescription?.trim() || null, createdBy: ctx.userId }).returning();
    await audit(tx, ctx, { action: "masterdata.customer_item_code.changed", entityType: "customer", entityId: c.id, entityNumber: c.code, siteId: null, before: before ?? null, after: row });
    return row;
  });
}

/** Item codes of several products for one customer (order entry, documents). */
export async function itemCodeMap(q: DbOrTx, customerId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, string>();
  const rows = await q.select().from(customerItemCodes).where(and(eq(customerItemCodes.customerId, customerId), inArray(customerItemCodes.productId, productIds)));
  return new Map(rows.map((r) => [r.productId, r.customerItemCode]));
}

/** Options for the requirement, artwork and item-code forms of a customer page. */
export async function requirementFormOptions(ctx: AuthContext, customerId: string) {
  ctx.require("masterdata.customer_requirement.view");
  const prods = await db
    .select({ id: products.id, skuCode: products.skuCode, name: products.name })
    .from(products)
    .where(and(eq(products.organizationId, ctx.organizationId), eq(products.status, "active")))
    .orderBy(asc(products.skuCode));
  const artwork = (await listArtworkVersions(ctx, customerId)).filter((a) => a.status === "active");
  return { products: prods, artwork: artwork.map((a) => ({ id: a.id, label: `${a.artworkCode} ${a.versionLabel} (${a.sku})`, productId: a.productId })) };
}

/** Pending requirement versions waiting for a decision (approval queue). */
export async function pendingRequirementCount(ctx: AuthContext) {
  if (!ctx.can("masterdata.customer_requirement.approve")) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(customerRequirements).where(and(eq(customerRequirements.organizationId, ctx.organizationId), eq(customerRequirements.status, "pending_approval")));
  return Number(r?.n ?? 0);
}
