import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * The name a person knows a record by, for the activity feed (UX audit C #6, round 2 part 2): the customer of an
 * order, invoice, offer or delivery; the supplier of a receipt or purchase order; the product or material of a
 * batch, production order or lot; the kind of a paper ("delivery receipt"). One small query per entity type for
 * the ids shown (≤ 50), always inside the caller's organization. Unknown types get no name (the noun is enough).
 */
/** `($1::uuid, $2::uuid)`: drizzle expands a JS array inside sql`` into a parameter list, never into one array. */
const list = (ids: string[]) => sql`(${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;

const QUERIES: Record<string, (org: string, ids: string[]) => ReturnType<typeof sql>> = {
  sales_order: (org, ids) => sql`select so.id::text as id, c.name from sales_orders so join customers c on c.id = so.customer_id where so.organization_id = ${org}::uuid and so.id in ${list(ids)}`,
  shipment: (org, ids) => sql`select sh.id::text as id, c.name from shipments sh join sales_orders so on so.id = sh.sales_order_id join customers c on c.id = so.customer_id where sh.organization_id = ${org}::uuid and sh.id in ${list(ids)}`,
  invoice: (org, ids) => sql`select i.id::text as id, c.name from invoices i join customers c on c.id = i.customer_id where i.organization_id = ${org}::uuid and i.id in ${list(ids)}`,
  quote: (org, ids) => sql`select q.id::text as id, c.name from quotes q join customers c on c.id = q.customer_id where q.organization_id = ${org}::uuid and q.id in ${list(ids)}`,
  customer_return: (org, ids) => sql`select r.id::text as id, c.name from customer_returns r join customers c on c.id = r.customer_id where r.organization_id = ${org}::uuid and r.id in ${list(ids)}`,
  complaint: (org, ids) => sql`select r.id::text as id, c.name from complaints r join customers c on c.id = r.customer_id where r.organization_id = ${org}::uuid and r.id in ${list(ids)}`,
  customer: (org, ids) => sql`select id::text as id, name from customers where organization_id = ${org}::uuid and id in ${list(ids)}`,
  supplier: (org, ids) => sql`select id::text as id, name from suppliers where organization_id = ${org}::uuid and id in ${list(ids)}`,
  material: (org, ids) => sql`select id::text as id, name from materials where organization_id = ${org}::uuid and id in ${list(ids)}`,
  product: (org, ids) => sql`select id::text as id, name from products where organization_id = ${org}::uuid and id in ${list(ids)}`,
  goods_receipt: (org, ids) => sql`select g.id::text as id, coalesce(s.name, g.supplier_name) as name from goods_receipts g left join suppliers s on s.id = g.supplier_id where g.organization_id = ${org}::uuid and g.id in ${list(ids)}`,
  purchase_order: (org, ids) => sql`select p.id::text as id, s.name from purchase_orders p join suppliers s on s.id = p.supplier_id where p.organization_id = ${org}::uuid and p.id in ${list(ids)}`,
  batch: (org, ids) => sql`select b.id::text as id, p.name from batches b join products p on p.id = b.product_id where b.organization_id = ${org}::uuid and b.id in ${list(ids)}`,
  work_order: (org, ids) => sql`select w.id::text as id, p.name from work_orders w join products p on p.id = w.product_id where w.organization_id = ${org}::uuid and w.id in ${list(ids)}`,
  inventory_lot: (org, ids) => sql`select l.id::text as id, coalesce(m.name, p.name) as name from inventory_lots l left join materials m on m.id = l.material_id left join products p on p.id = l.product_id where l.organization_id = ${org}::uuid and l.id in ${list(ids)}`,
  generated_document: (org, ids) => sql`select id::text as id, replace(document_kind, '_', ' ') as name from generated_documents where organization_id = ${org}::uuid and id in ${list(ids)}`,
};
QUERIES.lot = QUERIES.inventory_lot;

export async function activityEntityNames(organizationId: string, rows: { entityType: string; entityId: string | null }[]): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.entityId || !QUERIES[r.entityType] || !/^[0-9a-f-]{36}$/i.test(r.entityId)) continue;
    (byType.get(r.entityType) ?? byType.set(r.entityType, new Set()).get(r.entityType)!).add(r.entityId);
  }
  const out = new Map<string, string>();
  await Promise.all(
    [...byType].map(async ([type, ids]) => {
      const found = await db.execute<{ id: string; name: string | null }>(QUERIES[type](organizationId, [...ids])).catch(() => [] as { id: string; name: string | null }[]);
      for (const f of found) if (f.name) out.set(`${type}:${f.id}`, f.name);
    }),
  );
  return out;
}
