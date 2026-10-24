import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, customerRequirements, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { creditSummary } from "./credit";
import { getCustomer } from "./customers";
import { listCustomerOrders } from "./orders";
import { listPriceLists } from "./price-lists";
import { listCustomerQuotes } from "./quotations";
import { listItemCodes, listRequirements } from "./requirements";

/**
 * Customer 360 (US-4-06, docs/ux-system.md §9.8): profile, contacts, addresses, requirements, open
 * orders, quotations, shipments, price lists and credit — each part only when the caller holds its
 * view permission; credit and prices are masked by role. Other modules (complaints, invoices) plug in
 * a section with `registerCustomer360Section` (wired in src/modules/wiring.ts), so this read model
 * never imports them.
 */

export type Customer360Row = { id: string; label: string; sublabel?: string | null; status?: string | null; href?: string | null; at?: Date | string | null };
export type Customer360Section = {
  key: string;
  title: string;
  permission: Permission;
  load: (ctx: AuthContext, customerId: string) => Promise<Customer360Row[]>;
};

const REGISTRY_KEY = Symbol.for("bryels.sales.customer360Sections");
type Registry = Map<string, Customer360Section>;
function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  g[REGISTRY_KEY] ??= new Map();
  return g[REGISTRY_KEY]!;
}

/** Adds (or replaces) a section on the customer page; idempotent. */
export function registerCustomer360Section(section: Customer360Section) {
  registry().set(section.key, section);
}

const OPEN = ["draft", "submitted", "pending_approval", "confirmed", "allocated", "picking", "packed", "partially_shipped"];

export async function getCustomer360(ctx: AuthContext, customerId: string) {
  const base = await getCustomer(ctx, customerId);
  const id = base.customer.id;
  const [orders, quotes, requirements, itemCodes, priceLists, credit] = await Promise.all([
    ctx.can("sales.sales_order.view") ? listCustomerOrders(ctx, id) : Promise.resolve([]),
    ctx.can("sales.quote.view") ? listCustomerQuotes(ctx, id) : Promise.resolve([]),
    ctx.can("masterdata.customer_requirement.view") ? listRequirements(ctx, id) : Promise.resolve([]),
    listItemCodes(db, id),
    ctx.can("sales.price_list.view") ? listPriceLists(ctx, { customerId: id }) : Promise.resolve([]),
    ctx.can("finance.credit_terms.view") ? creditSummary(ctx, id) : Promise.resolve(null),
  ]);
  const sections: { key: string; title: string; rows: Customer360Row[] }[] = [];
  for (const s of registry().values()) {
    if (!ctx.can(s.permission)) continue;
    sections.push({ key: s.key, title: s.title, rows: await s.load(ctx, id) });
  }
  // History: what changed on the customer record and its addresses, contacts and requirements (no values).
  const reqIds = requirements.length ? requirements.map((r) => r.id) : (await db.select({ id: customerRequirements.id }).from(customerRequirements).where(eq(customerRequirements.customerId, id))).map((r) => r.id);
  const entityIds = [id, ...base.addresses.map((a) => a.id), ...base.contacts.map((c) => c.id), ...reqIds];
  const history = await db
    .select({ id: auditEvents.id, action: auditEvents.action, occurredAt: auditEvents.occurredAt, actor: users.displayName, actorLabel: auditEvents.actorLabel, reason: auditEvents.reason })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.organizationId, ctx.organizationId), inArray(auditEvents.entityId, entityIds)))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(50);
  return {
    ...base,
    orders,
    openOrders: orders.filter((o) => OPEN.includes(o.status)),
    quotes,
    requirements,
    itemCodes,
    priceLists,
    credit,
    sections,
    history: history.map((h) => ({ ...h, actor: h.actor ?? h.actorLabel ?? "System", reason: ctx.can("platform.audit.view") ? h.reason : null })),
  };
}
export type Customer360 = Awaited<ReturnType<typeof getCustomer360>>;
