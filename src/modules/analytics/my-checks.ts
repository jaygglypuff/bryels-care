import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { myFloorTasks } from "@/modules/production";

/**
 * "Waiting for you to check" on Home (round 5, ADR-129; A report #11, B13 and problem 1): the second-person checks this
 * person may sign now, at the current site. A site manager or a checker sees the weighing, the step and the box check
 * waiting for them, with names, instead of finding them only in the bell. Never their own work (the same-person rule:
 * the weigher, the person who did the step, and the person who took the boxes off the shelf are left out here and again
 * by the deciding service).
 */
export type CheckItem = { key: string; text: string; detail: string; href: string; button: string };

export async function checksWaitingForMe(ctx: AuthContext): Promise<CheckItem[]> {
  const site = ctx.currentSiteId;
  const out: CheckItem[] = [];
  // Weighing and step checks of batches (floor tasks of kind "check" the person can sign now).
  if (ctx.canAt("production.batch.view", site) && (ctx.canAt("production.dispense_record.approve", site) || ctx.canAt("production.process_step_record.approve", site))) {
    const tasks = await myFloorTasks(ctx).catch(() => []);
    for (const t of tasks)
      if (t.kind === "check" && t.canDo) out.push({ key: `batch:${t.batchId}`, text: `${t.title}: ${t.productName}`, detail: `Batch ${t.batchNumber} · ${t.stepLabel}`, href: t.href, button: "Check" });
  }
  // Box checks: deliveries taken off the shelf by someone else, waiting for the second check (status "picked").
  if (ctx.canAt("inventory.pack.approve", site) && ctx.canAt("sales.shipment.view", site)) {
    const rows = (await db.execute(sql`
      select s.id::text as id, s.shipment_number as number, c.name as customer,
        (select string_agg(distinct split_part(u.display_name, ' ', 1), ', ') from picks pk join users u on u.id = pk.completed_by where pk.shipment_id = s.id) as pickers
      from shipments s
      join sales_orders so on so.id = s.sales_order_id
      join customers c on c.id = so.customer_id
      where s.organization_id = ${ctx.organizationId}::uuid and s.site_id = ${site}::uuid and s.status = 'picked'
        and not exists (select 1 from picks pk where pk.shipment_id = s.id and pk.completed_by = ${ctx.userId}::uuid)
        and not exists (select 1 from pick_lines pl join picks pk on pk.id = pl.pick_id where pk.shipment_id = s.id and pl.picked_by = ${ctx.userId}::uuid)
      order by s.created_at asc
      limit 20`).catch(() => [])) as unknown as { id: string; number: string; customer: string; pickers: string | null }[];
    for (const r of rows)
      out.push({
        key: `shipment:${r.id}`,
        text: `Check the boxes for ${r.customer}`,
        detail: `${r.pickers ? `${r.pickers} got them from the shelf · ` : ""}Delivery ${r.number}`,
        href: `/sales/packing/${r.id}`,
        button: "Check the boxes",
      });
  }
  return out;
}
