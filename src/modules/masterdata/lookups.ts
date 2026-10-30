import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { LOOKUP_LIST_KEYS, customers, lookupValues, materials, products, suppliers } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { reqText } from "./org-common";
import { parseInput } from "./schemas";

/**
 * ADR-076: editable dropdown lists ("Master data → Lists"). The list definitions live here (title, where
 * the list is used, shipped default options, how use is counted); the options live in `lookup_values`.
 *
 * - The code of an option is what records store; it never changes. Renaming changes only the label.
 * - Options are reordered and deactivated; an option that records use is never deleted (deactivation
 *   keeps history readable and stops new use). An unused option may be deleted.
 * - While an organization has no rows for a list, the defaults below stand in (same pattern as reason
 *   codes); the first change writes them as rows under a lock, so two admins never fork the list.
 * - Organization-wide reference data (siteId null in the audit trail), like reason codes and units.
 *
 * Lists that drive program logic (statuses and state machines, location kinds, material class,
 * discrepancy types, document kinds) are fixed in code and never appear here.
 */

export type LookupListKey = (typeof LOOKUP_LIST_KEYS)[number];
export { LOOKUP_LIST_KEYS };

type Opt = { code: string; label: string };
type ListDef = {
  key: LookupListKey;
  title: string;
  description: string;
  /** Screens where the list is a dropdown (plain words for the owner). */
  usedOn: string;
  defaults: readonly Opt[];
  /** At least this many options must stay active (a required field needs one to choose). */
  minActive: number;
  /** Records that store the code (use count; an option in use cannot be deleted). */
  usage: (q: DbOrTx, organizationId: string, code: string) => Promise<number>;
};

const countWhere = async (q: DbOrTx, table: typeof products | typeof materials | typeof customers | typeof suppliers, where: ReturnType<typeof and>) => {
  const [r] = await q.select({ n: count() }).from(table).where(where);
  return Number(r?.n ?? 0);
};

export const LOOKUP_LISTS: Record<LookupListKey, ListDef> = {
  product_family: {
    key: "product_family",
    title: "Product families",
    description: "Groups of finished products, e.g. Soap or Lotion.",
    usedOn: "Products",
    // Codes equal the former setting values (masterdata.product_families) so existing products keep matching.
    defaults: [
      { code: "Soap", label: "Soap" },
      { code: "Lotion", label: "Lotion" },
      { code: "Cream", label: "Cream" },
      { code: "Oil", label: "Oil" },
      { code: "Other", label: "Other" },
    ],
    minActive: 1,
    usage: (q, o, c) => countWhere(q, products, and(eq(products.organizationId, o), eq(products.family, c))),
  },
  material_category: {
    key: "material_category",
    title: "Material categories",
    description: "Groups of materials, e.g. Oils and fats or Bottles and caps. For finding and reports only.",
    usedOn: "Materials",
    defaults: [
      { code: "oils_fats", label: "Oils and fats" },
      { code: "butters_waxes", label: "Butters and waxes" },
      { code: "lye_chemicals", label: "Lye and chemicals" },
      { code: "fragrance", label: "Fragrance and essential oils" },
      { code: "colour_additives", label: "Colours and additives" },
      { code: "bottles_caps", label: "Bottles, jars and caps" },
      { code: "labels_boxes", label: "Labels and boxes" },
      { code: "other", label: "Other" },
    ],
    minActive: 0,
    usage: (q, o, c) => countWhere(q, materials, and(eq(materials.organizationId, o), eq(materials.category, c))),
  },
  customer_segment: {
    key: "customer_segment",
    title: "Customer types",
    description: "Kinds of customers, e.g. Salon or Distributor. For filters and reports.",
    usedOn: "Customers",
    // Codes equal the former fixed list (CUSTOMER_SEGMENTS) so existing customers keep matching.
    defaults: [
      { code: "pharmacy_chain", label: "Pharmacy chain" },
      { code: "salon_spa", label: "Salon / spa" },
      { code: "distributor", label: "Distributor" },
      { code: "online_reseller", label: "Online reseller" },
      { code: "retail_store", label: "Retail store" },
      { code: "other", label: "Other" },
    ],
    minActive: 0,
    usage: (q, o, c) => countWhere(q, customers, and(eq(customers.organizationId, o), eq(customers.segment, c))),
  },
  supplier_category: {
    key: "supplier_category",
    title: "Supplier categories",
    description: "What a supplier mainly sells, e.g. Oils or Packaging.",
    usedOn: "Suppliers",
    defaults: [
      { code: "oils_chemicals", label: "Oils and chemicals" },
      { code: "fragrance", label: "Fragrance" },
      { code: "packaging", label: "Packaging" },
      { code: "printing", label: "Labels and printing" },
      { code: "services", label: "Services" },
      { code: "other", label: "Other" },
    ],
    minActive: 0,
    usage: (q, o, c) => countWhere(q, suppliers, and(eq(suppliers.organizationId, o), eq(suppliers.category, c))),
  },
};

/** Lists the owner can change, but on their own screen (they carry more than a label). Shown as links on the Lists screen. */
export const LISTS_ELSEWHERE: readonly { title: string; description: string; href: string; permission: Permission }[] = [
  { title: "Reason codes", description: "Why stock was adjusted, scrapped, held or returned (also defect and scrap reasons).", href: "/masterdata/reason-codes", permission: "masterdata.reason_code.view" },
  { title: "Units of measure", description: "Units such as g, kg, L, pcs and their conversions.", href: "/masterdata/uom", permission: "masterdata.uom.view" },
  { title: "Quality and finance lists", description: "Complaint categories, severity levels, risk levels, expense and bill categories. A change needs a second person's approval.", href: "/admin/settings", permission: "platform.settings.view" },
];

export const isLookupListKey = (k: string): k is LookupListKey => (LOOKUP_LIST_KEYS as readonly string[]).includes(k);

export type LookupOption = { code: string; label: string; sortOrder: number; isActive: boolean };

/** The organization's options of a list (all, display order); the defaults stand in while it has none. */
async function listRows(q: DbOrTx, organizationId: string, key: LookupListKey): Promise<(LookupOption & { id: string | null })[]> {
  const rows = await q
    .select({ id: lookupValues.id, code: lookupValues.code, label: lookupValues.label, sortOrder: lookupValues.sortOrder, isActive: lookupValues.isActive })
    .from(lookupValues)
    .where(and(eq(lookupValues.organizationId, organizationId), eq(lookupValues.listKey, key)))
    .orderBy(asc(lookupValues.sortOrder), asc(lookupValues.label));
  if (rows.length) return rows;
  return LOOKUP_LISTS[key].defaults.map((d, i) => ({ id: null, code: d.code, label: d.label, sortOrder: (i + 1) * 10, isActive: true }));
}

/**
 * Options a form offers (active only, display order). `keep`: a stored code shown even when inactive
 * (an edit form must not silently change a record's value).
 */
export async function lookupOptions(q: DbOrTx, organizationId: string, key: LookupListKey, opts: { keep?: string | null } = {}): Promise<{ value: string; label: string }[]> {
  const rows = await listRows(q, organizationId, key);
  return rows.filter((r) => r.isActive || (opts.keep && r.code === opts.keep)).map((r) => ({ value: r.code, label: r.isActive ? r.label : `${r.label} (no longer used)` }));
}

/** Display labels of a list (inactive included); an unknown code shows as itself. */
export async function lookupLabels(q: DbOrTx, organizationId: string, key: LookupListKey): Promise<Map<string, string>> {
  return new Map((await listRows(q, organizationId, key)).map((r) => [r.code, r.label]));
}

/**
 * Validates a value for a new or edited record: the code (or the label, any case) of an active option.
 * Returns the code to store, or null when empty and `required` is false. `keep`: the record's current
 * code stays valid on edit even after it was deactivated.
 */
export async function assertLookupValue(q: DbOrTx, organizationId: string, key: LookupListKey, raw: string | null | undefined, opts: { field: string; required?: boolean; keep?: string | null }): Promise<string | null> {
  const v = (raw ?? "").trim();
  const def = LOOKUP_LISTS[key];
  if (!v) {
    if (opts.required) throw new DomainError("validation", `Choose one of the ${def.title.toLowerCase()}.`, { field: opts.field });
    return null;
  }
  const rows = await listRows(q, organizationId, key);
  const lc = v.toLowerCase();
  const match = rows.find((r) => r.code === v) ?? rows.find((r) => r.code.toLowerCase() === lc || r.label.toLowerCase() === lc);
  if (match && (match.isActive || match.code === opts.keep)) {
    // Inside the caller's transaction a share lock keeps the option from being deleted until the record commits
    // (deleteLookupValue counts uses under FOR UPDATE of the list's rows).
    if (!match.id) return match.code;
    const [still] = await q.select({ id: lookupValues.id }).from(lookupValues).where(eq(lookupValues.id, match.id)).for("share");
    if (still) return match.code;
  }
  const active = rows.filter((r) => r.isActive).map((r) => r.label);
  const msg = match && !match.isActive ? `"${match.label}" is no longer used. Choose another option.` : `Choose one of the ${def.title.toLowerCase()}${active.length ? `: ${active.join(", ")}` : ""}. An admin can add options under Management → Master data → Lists.`;
  throw new DomainError("validation", msg, { field: opts.field });
}

/* ------------------------------------------------------------------ admin screen */

export type LookupListView = {
  key: LookupListKey;
  title: string;
  description: string;
  usedOn: string;
  values: (LookupOption & { inUse: number })[];
};

/** Every editable list with its options and how many records use each option (Master data → Lists). */
export async function listLookupLists(ctx: AuthContext): Promise<LookupListView[]> {
  ctx.require("masterdata.lookup_value.view");
  const out: LookupListView[] = [];
  for (const key of LOOKUP_LIST_KEYS) {
    const def = LOOKUP_LISTS[key];
    const rows = await listRows(db, ctx.organizationId, key);
    const values = await Promise.all(rows.map(async (r) => ({ code: r.code, label: r.label, sortOrder: r.sortOrder, isActive: r.isActive, inUse: await def.usage(db, ctx.organizationId, r.code) })));
    out.push({ key, title: def.title, description: def.description, usedOn: def.usedOn, values });
  }
  return out;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Writes the defaults as rows when the list has none yet, then locks the list's rows (serializes edits of one list). */
async function lockList(tx: Tx, ctx: AuthContext, key: LookupListKey) {
  const existing = await tx.select({ id: lookupValues.id }).from(lookupValues).where(and(eq(lookupValues.organizationId, ctx.organizationId), eq(lookupValues.listKey, key))).limit(1);
  if (!existing.length) {
    await tx
      .insert(lookupValues)
      .values(LOOKUP_LISTS[key].defaults.map((d, i) => ({ organizationId: ctx.organizationId, listKey: key, code: d.code, label: d.label, sortOrder: (i + 1) * 10, createdBy: ctx.userId, updatedBy: ctx.userId })))
      .onConflictDoNothing();
  }
  return tx
    .select()
    .from(lookupValues)
    .where(and(eq(lookupValues.organizationId, ctx.organizationId), eq(lookupValues.listKey, key)))
    .orderBy(asc(lookupValues.sortOrder), asc(lookupValues.label))
    .for("update");
}

const ListKey = z.string().refine(isLookupListKey, "Choose a list.");
const Label = reqText("the name people see", 60);
const Code = z.string().trim().min(1, "Choose an option.").max(40);

const AddInput = z.object({ listKey: ListKey, label: Label }).strict();
const RenameInput = z.object({ listKey: ListKey, code: Code, label: Label }).strict();
const MoveInput = z.object({ listKey: ListKey, code: Code, direction: z.enum(["up", "down"]) }).strict();
const ActiveInput = z.object({ listKey: ListKey, code: Code, active: z.boolean() }).strict();
const DeleteInput = z.object({ listKey: ListKey, code: Code }).strict();

/** Stored code for a new option: lower-case words joined by "_" (max 40), unique within the list. */
export function codeFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "option";
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (!lower.has(base)) return base;
  for (let i = 2; ; i++) if (!lower.has(`${base}_${i}`)) return `${base}_${i}`;
}

const labelTaken = (rows: { code: string; label: string }[], label: string, except?: string) => rows.some((r) => r.code !== except && r.label.trim().toLowerCase() === label.trim().toLowerCase());
const entity = (key: LookupListKey, code: string) => `${key}:${code}`;

function find(rows: (typeof lookupValues.$inferSelect)[], code: string, key: LookupListKey) {
  const r = rows.find((x) => x.code === code);
  if (!r) throw new DomainError("not_found", `That option is not in ${LOOKUP_LISTS[key].title}.`);
  return r;
}

/** Adds an option at the end of the list. A name already in the list (any case) is refused. */
export async function addLookupValue(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.lookup_value.admin");
  ctx.assertWritable();
  const v = parseInput(AddInput, raw);
  const key = v.listKey as LookupListKey;
  return db.transaction(async (tx) => {
    const rows = await lockList(tx, ctx, key);
    if (labelTaken(rows, v.label)) throw new DomainError("conflict", `"${v.label}" is already in ${LOOKUP_LISTS[key].title}.`, { field: "label" });
    if (rows.length >= 200) throw new DomainError("validation", "A list can have at most 200 options.", { field: "label" });
    const code = codeFromLabel(v.label, new Set(rows.map((r) => r.code)));
    const sortOrder = Math.min(9999, Math.max(0, ...rows.map((r) => r.sortOrder)) + 10);
    const [row] = await tx.insert(lookupValues).values({ organizationId: ctx.organizationId, listKey: key, code, label: v.label, sortOrder, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    await audit(tx, ctx, { action: "masterdata.lookup_value.created", entityType: "lookup_value", entityId: row.id, entityNumber: entity(key, code), siteId: null, after: { listKey: key, code, label: row.label, sortOrder } });
    return row;
  });
}

/** Renames an option. Records keep the code, so every screen shows the new name at once. */
export async function renameLookupValue(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.lookup_value.admin");
  ctx.assertWritable();
  const v = parseInput(RenameInput, raw);
  const key = v.listKey as LookupListKey;
  return db.transaction(async (tx) => {
    const rows = await lockList(tx, ctx, key);
    const before = find(rows, v.code, key);
    if (before.label === v.label) return before;
    if (labelTaken(rows, v.label, before.code)) throw new DomainError("conflict", `"${v.label}" is already in ${LOOKUP_LISTS[key].title}.`, { field: "label" });
    const [after] = await tx.update(lookupValues).set({ label: v.label, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(lookupValues.id, before.id)).returning();
    await audit(tx, ctx, { action: "masterdata.lookup_value.updated", entityType: "lookup_value", entityId: after.id, entityNumber: entity(key, after.code), siteId: null, before: { label: before.label }, after: { label: after.label } });
    return after;
  });
}

/** Moves an option one place up or down; the list is renumbered 10, 20, 30… */
export async function moveLookupValue(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.lookup_value.admin");
  ctx.assertWritable();
  const v = parseInput(MoveInput, raw);
  const key = v.listKey as LookupListKey;
  return db.transaction(async (tx) => {
    const rows = await lockList(tx, ctx, key);
    const i = rows.findIndex((r) => r.code === v.code);
    if (i < 0) throw new DomainError("not_found", `That option is not in ${LOOKUP_LISTS[key].title}.`);
    const j = v.direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return { moved: false };
    const order = [...rows];
    [order[i], order[j]] = [order[j], order[i]];
    const now = new Date();
    for (const [n, r] of order.entries()) {
      const sortOrder = (n + 1) * 10;
      if (r.sortOrder !== sortOrder) await tx.update(lookupValues).set({ sortOrder, updatedAt: now, updatedBy: ctx.userId }).where(eq(lookupValues.id, r.id));
    }
    await audit(tx, ctx, {
      action: "masterdata.lookup_value.updated",
      entityType: "lookup_value",
      entityId: rows[i].id,
      entityNumber: entity(key, v.code),
      siteId: null,
      before: { order: rows.map((r) => r.code) },
      after: { order: order.map((r) => r.code) },
    });
    return { moved: true };
  });
}

/** Turns an option off (no longer offered; records that use it keep it) or back on. */
export async function setLookupValueActive(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.lookup_value.admin");
  ctx.assertWritable();
  const v = parseInput(ActiveInput, raw);
  const key = v.listKey as LookupListKey;
  const def = LOOKUP_LISTS[key];
  return db.transaction(async (tx) => {
    const rows = await lockList(tx, ctx, key);
    const before = find(rows, v.code, key);
    if (before.isActive === v.active) return before;
    if (!v.active && rows.filter((r) => r.isActive && r.code !== before.code).length < def.minActive) {
      throw new DomainError("state", `${def.title} needs at least ${def.minActive} option in use. Add another option before turning this one off.`, { field: "code" });
    }
    const [after] = await tx.update(lookupValues).set({ isActive: v.active, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(lookupValues.id, before.id)).returning();
    await audit(tx, ctx, { action: "masterdata.lookup_value.updated", entityType: "lookup_value", entityId: after.id, entityNumber: entity(key, after.code), siteId: null, before: { isActive: before.isActive }, after: { isActive: after.isActive } });
    return after;
  });
}

/** Deletes an option that no record uses (a typo, say). An option in use can only be turned off. */
export async function deleteLookupValue(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.lookup_value.admin");
  ctx.assertWritable();
  const v = parseInput(DeleteInput, raw);
  const key = v.listKey as LookupListKey;
  const def = LOOKUP_LISTS[key];
  return db.transaction(async (tx) => {
    const rows = await lockList(tx, ctx, key);
    const before = find(rows, v.code, key);
    const used = await def.usage(tx, ctx.organizationId, before.code);
    if (used > 0) throw new DomainError("state", `"${before.label}" is used by ${used} record${used === 1 ? "" : "s"}, so it cannot be deleted. Turn it off instead: it stays on those records but is no longer offered.`, { field: "code" });
    if (before.isActive && rows.filter((r) => r.isActive && r.code !== before.code).length < def.minActive) {
      throw new DomainError("state", `${def.title} needs at least ${def.minActive} option in use.`, { field: "code" });
    }
    await tx.delete(lookupValues).where(eq(lookupValues.id, before.id));
    await audit(tx, ctx, { action: "masterdata.lookup_value.deleted", entityType: "lookup_value", entityId: before.id, entityNumber: entity(key, before.code), siteId: null, before: { listKey: key, code: before.code, label: before.label, isActive: before.isActive } });
    return { deleted: true };
  });
}

/** Raw count used by tests and the screen header. */
export async function lookupValueCount(q: DbOrTx, organizationId: string, key: LookupListKey) {
  const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(lookupValues).where(and(eq(lookupValues.organizationId, organizationId), eq(lookupValues.listKey, key)));
  return r?.n ?? 0;
}
