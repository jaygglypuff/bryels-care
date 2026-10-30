import "server-only";
import Decimal from "decimal.js";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { fmtStock } from "@/modules/inventory";

/**
 * Universal search behind "Scan or search" (owner review 2026-10-30, extends ADR-085): typed words are
 * looked up in every place the owner asks about, grouped, at most 5 per group, each a plain line and a link.
 *
 * Scope and permissions are enforced HERE, per group:
 * | Group            | Needs                              | Site scope                                   |
 * |------------------|------------------------------------|----------------------------------------------|
 * | Items            | inventory.lot.view                 | stock totals at the current site only        |
 * | Lots             | inventory.lot.view                 | caller's sites (keywordMatches, ADR-085)     |
 * | Batches          | production.batch.view              | sites where the caller holds it              |
 * | Customer orders  | sales.sales_order.view             | sites where the caller holds it              |
 * | Purchase orders  | procurement.purchase_order.view    | sites where the caller holds it              |
 * | Customers        | masterdata.customer.view           | organisation master data                     |
 * | Suppliers        | masterdata.supplier.view           | organisation master data                     |
 * A group the caller may not see is not queried at all (not even counted). Every word must match (AND),
 * any case. Reads only.
 */

export type SearchHit = { title: string; detail: string; href: string };
export type SearchGroupKey = "items" | "lots" | "batches" | "sales_orders" | "purchase_orders" | "customers" | "suppliers";
export type SearchGroup = { key: SearchGroupKey; label: string; hits: SearchHit[] };

export const GROUP_LIMIT = 5;

const GROUP_LABEL: Record<SearchGroupKey, string> = {
  items: "Materials and products",
  lots: "Lots",
  batches: "Batches",
  sales_orders: "Customer orders",
  purchase_orders: "Purchase orders",
  customers: "Customers",
  suppliers: "Suppliers",
};

const SO_WORDS: Record<string, string> = { draft: "draft", submitted: "submitted", pending_approval: "waiting for approval", confirmed: "confirmed", allocated: "stock reserved", picking: "being picked", packed: "packed", partially_shipped: "partly shipped", shipped: "shipped", invoiced: "invoiced", closed: "closed", cancelled: "cancelled" };
const PO_WORDS: Record<string, string> = { draft: "draft", submitted: "waiting for approval", approved: "approved, not sent", sent: "sent to supplier", partially_received: "partly received", received: "received", closed: "closed", cancelled: "cancelled" };
const BATCH_WORDS: Record<string, string> = { draft: "draft", planned: "planned", materials_staged: "materials ready", in_process: "being made", awaiting_qc: "waiting for quality check", quarantined: "waiting for quality check", released: "released", rejected: "rejected", rework_approved: "rework approved", closed: "closed" };
const plain = (map: Record<string, string>, s: string) => map[s] ?? s.replace(/_/g, " ");

/** Lowercase words, LIKE wildcards removed, ≥ 2 characters, at most 5. */
export function searchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/[%_\\]/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 5);
}

/** Every word must hit one of the columns. */
function allWords(words: string[], cols: SQL[]): SQL {
  return sql.join(
    words.map((w) => {
      const like = `%${w}%`;
      return sql`(${sql.join(cols.map((c) => sql`coalesce(${c}, '') ilike ${like}`), sql` or `)})`;
    }),
    sql` and `,
  );
}

const sitesWith = (ctx: AuthContext, p: Permission) => ctx.allowedSiteIds.filter((s) => ctx.canAt(p, s));
const inList = (ids: string[]) => sql.join(ids.map((s) => sql`${s}::uuid`), sql`, `);

function siteCode(ctx: AuthContext, siteId: string): string | null {
  return ctx.allowedSites.length > 1 ? (ctx.allowedSites.find((s) => s.id === siteId)?.code ?? null) : null;
}

async function items(ctx: AuthContext, words: string[]): Promise<SearchHit[]> {
  if (!ctx.can("inventory.lot.view")) return [];
  const site = ctx.currentSiteId;
  const rows = (await db.execute(sql`
    with stock as (
      select l.material_id, l.product_id,
             sum(b.qty_base) filter (where l.quality_status = 'released' and (l.expires_on is null or l.expires_on >= (now() at time zone 'Asia/Manila')::date)) as usable,
             sum(b.qty_base) as total
        from inventory_balances b join inventory_lots l on l.id = b.lot_id
       where b.site_id = ${site}::uuid and b.qty_base > 0 and l.organization_id = ${ctx.organizationId}::uuid
       group by 1, 2
    )
    select * from (
      select 'material' as kind, m.id, m.code, m.name, m.base_uom as unit, coalesce(st.usable, 0)::text as usable, coalesce(st.total, 0)::text as total
        from materials m left join stock st on st.material_id = m.id
       where m.organization_id = ${ctx.organizationId}::uuid and m.status <> 'discontinued' and ${allWords(words, [sql`m.name`, sql`m.code`, sql`m.common_name`])}
      union all
      select 'product', p.id, p.sku_code, p.name, p.base_uom, coalesce(st.usable, 0)::text, coalesce(st.total, 0)::text
        from products p left join stock st on st.product_id = p.id
       where p.organization_id = ${ctx.organizationId}::uuid and p.status <> 'discontinued' and ${allWords(words, [sql`p.name`, sql`p.sku_code`])}
    ) x
    order by (total::numeric > 0) desc, name asc
    limit ${GROUP_LIMIT}`)) as unknown as { kind: "material" | "product"; id: string; code: string; name: string; unit: string; usable: string; total: string }[];
  return rows.map((r) => {
    const usable = new Decimal(r.usable);
    const rest = new Decimal(r.total).minus(usable);
    const parts = [
      new Decimal(r.total).isZero() ? `none in stock at ${ctx.currentSite.code}` : `${fmtStock(usable, r.unit)} OK to use at ${ctx.currentSite.code}`,
      rest.gt(0) ? `${fmtStock(rest, r.unit)} not usable yet or blocked` : null,
      r.code,
    ].filter(Boolean);
    return { title: r.name, detail: parts.join(" · "), href: `/inventory/items/${r.kind}/${r.id}` }; // the item page: totals, suppliers, expiry, every lot
  });
}

async function batches(ctx: AuthContext, words: string[]): Promise<SearchHit[]> {
  const siteIds = sitesWith(ctx, "production.batch.view");
  if (!siteIds.length) return [];
  const rows = (await db.execute(sql`
    select b.id, b.batch_number, b.status, b.site_id, p.name as product
      from batches b join products p on p.id = b.product_id
     where b.organization_id = ${ctx.organizationId}::uuid and b.site_id in (${inList(siteIds)})
       and ${allWords(words, [sql`b.batch_number`, sql`p.name`, sql`p.sku_code`])}
     order by b.created_at desc
     limit ${GROUP_LIMIT}`)) as unknown as { id: string; batch_number: string; status: string; site_id: string; product: string }[];
  return rows.map((r) => ({
    title: `Batch ${r.batch_number}`,
    detail: [r.product, plain(BATCH_WORDS, r.status), siteCode(ctx, r.site_id)].filter(Boolean).join(" · "),
    href: `/production/${r.id}`,
  }));
}

async function salesOrders(ctx: AuthContext, words: string[]): Promise<SearchHit[]> {
  const siteIds = sitesWith(ctx, "sales.sales_order.view");
  if (!siteIds.length) return [];
  const rows = (await db.execute(sql`
    select o.id, o.order_number, o.status, o.site_id, c.name as customer, o.customer_po_number
      from sales_orders o join customers c on c.id = o.customer_id
     where o.organization_id = ${ctx.organizationId}::uuid and o.site_id in (${inList(siteIds)})
       and ${allWords(words, [sql`o.order_number`, sql`o.customer_po_number`, sql`c.name`, sql`c.code`])}
     order by o.created_at desc
     limit ${GROUP_LIMIT}`)) as unknown as { id: string; order_number: string; status: string; site_id: string; customer: string; customer_po_number: string | null }[];
  return rows.map((r) => ({
    title: `Order ${r.order_number} · ${r.customer}`,
    detail: [plain(SO_WORDS, r.status), r.customer_po_number ? `their PO ${r.customer_po_number}` : null, siteCode(ctx, r.site_id)].filter(Boolean).join(" · "),
    href: `/sales/${r.id}`,
  }));
}

async function purchaseOrders(ctx: AuthContext, words: string[]): Promise<SearchHit[]> {
  const siteIds = sitesWith(ctx, "procurement.purchase_order.view");
  if (!siteIds.length) return [];
  const rows = (await db.execute(sql`
    select o.id, o.po_number, o.status, o.site_id, s.name as supplier, o.expected_date::text as expected
      from purchase_orders o join suppliers s on s.id = o.supplier_id
     where o.organization_id = ${ctx.organizationId}::uuid and o.site_id in (${inList(siteIds)})
       and ${allWords(words, [sql`o.po_number`, sql`o.legacy_number`, sql`s.name`, sql`s.code`])}
     order by o.created_at desc
     limit ${GROUP_LIMIT}`)) as unknown as { id: string; po_number: string; status: string; site_id: string; supplier: string; expected: string | null }[];
  return rows.map((r) => ({
    title: `Purchase order ${r.po_number} · ${r.supplier}`,
    detail: [plain(PO_WORDS, r.status), r.expected ? `expected ${r.expected}` : null, siteCode(ctx, r.site_id)].filter(Boolean).join(" · "),
    href: `/procurement/orders/${r.id}`,
  }));
}

async function customers(ctx: AuthContext, words: string[]): Promise<SearchHit[]> {
  if (!ctx.can("masterdata.customer.view")) return [];
  const rows = (await db.execute(sql`
    select c.id, c.code, c.name, c.status, c.contact_name
      from customers c
     where c.organization_id = ${ctx.organizationId}::uuid and ${allWords(words, [sql`c.name`, sql`c.code`, sql`c.contact_name`])}
     order by c.name asc
     limit ${GROUP_LIMIT}`)) as unknown as { id: string; code: string; name: string; status: string; contact_name: string | null }[];
  return rows.map((r) => ({
    title: r.name,
    detail: [r.contact_name ? `contact ${r.contact_name}` : null, r.status === "active" ? null : r.status.replace(/_/g, " "), r.code].filter(Boolean).join(" · "),
    href: `/sales/customers/${r.id}`,
  }));
}

async function suppliers(ctx: AuthContext, words: string[]): Promise<SearchHit[]> {
  if (!ctx.can("masterdata.supplier.view")) return [];
  const rows = (await db.execute(sql`
    select s.id, s.code, s.name, s.contact_name
      from suppliers s
     where s.organization_id = ${ctx.organizationId}::uuid and ${allWords(words, [sql`s.name`, sql`s.code`, sql`s.legacy_number`, sql`s.contact_name`])}
     order by s.name asc
     limit ${GROUP_LIMIT}`)) as unknown as { id: string; code: string; name: string; contact_name: string | null }[];
  return rows.map((r) => ({ title: r.name, detail: [r.contact_name ? `contact ${r.contact_name}` : null, r.code].filter(Boolean).join(" · "), href: `/masterdata/suppliers/${r.id}` }));
}

/**
 * Groups for typed words. `lots` are passed in (already computed by keywordMatches, ADR-085) so the look-up
 * runs once. Empty groups are left out.
 */
export async function searchEverything(ctx: AuthContext, text: string, lots: SearchHit[] = []): Promise<SearchGroup[]> {
  ctx.require("inventory.lot.view");
  const words = searchTerms(text);
  if (!words.length) return [];
  const [it, ba, so, po, cu, su] = await Promise.all([items(ctx, words), batches(ctx, words), salesOrders(ctx, words), purchaseOrders(ctx, words), customers(ctx, words), suppliers(ctx, words)]);
  const groups: [SearchGroupKey, SearchHit[]][] = [
    ["items", it],
    ["lots", lots.slice(0, GROUP_LIMIT)],
    ["batches", ba],
    ["sales_orders", so],
    ["purchase_orders", po],
    ["customers", cu],
    ["suppliers", su],
  ];
  return groups.filter(([, h]) => h.length > 0).map(([key, hits]) => ({ key, label: GROUP_LABEL[key], hits }));
}
