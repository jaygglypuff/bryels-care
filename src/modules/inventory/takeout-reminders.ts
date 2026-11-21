import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, sites } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { notifyUsers, usersForJob } from "@/modules/platform/notifications";
import { watchList } from "./takeout-queries";

/**
 * ADR-138 §3: catching missed take-outs. Daily (job `inventory.takeout_reminders`, 08:00 Asia/Manila):
 *
 * 1. Every open box of finished goods, and loose pieces on an online shop shelf, with no take-out and no count for
 *    `inventory.takeout.stale_days` days → one message to the warehouse people of the site (`usersForJob` with
 *    `inventory.takeout.create`, warehouse_operator first): "Count box BX-…: nothing written down for 4 days". One
 *    message per box and quiet spell (dedupe key carries the last activity), so a box that stays quiet is not
 *    re-sent every day. The message clears itself once the box is counted, taken from or emptied
 *    (notification-done.ts, kind `inventory.takeout.count_open_box`).
 * 2. On the weekday of `inventory.takeout.weekly_count_day` (0 = off): "Count the open boxes" to the same people,
 *    while the site has open boxes; it clears when every open box was counted since that day.
 */
export async function runTakeoutReminders(opts: { organizationId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const orgs = opts.organizationId ? [{ id: opts.organizationId }] : await db.select({ id: organizations.id }).from(organizations);
  let stale = 0;
  let weekly = 0;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  // ISO weekday 1 = Monday … 7 = Sunday, in Manila.
  const weekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  for (const org of orgs) {
    const siteRows = await db.select({ id: sites.id, code: sites.code }).from(sites).where(and(eq(sites.organizationId, org.id)));
    if (!siteRows.length) continue;
    const rows = await watchList(db, org.id, siteRows.map((s) => s.id), now);
    for (const site of siteRows) {
      const mine = rows.filter((r) => r.siteId === site.id);
      if (!mine.length) continue;
      const people = await usersForJob(db, org.id, "inventory.takeout.create", site.id, ["warehouse_operator"]);
      if (!people.length) continue;
      for (const r of mine.filter((x) => x.stale)) {
        const what = r.kind === "box" ? `box ${r.boxNumber}` : `the loose ${r.productName} on ${r.locationCode}`;
        const sent = await notifyUsers(db, people, {
          organizationId: org.id,
          siteId: site.id,
          kind: "inventory.takeout.count_open_box",
          severity: "info",
          title: `Count ${what}: nothing written down for ${r.days} days`,
          body: `${r.productName}, lot ${r.lotNumber}, ${r.pieces} left on ${r.locationName} (${r.locationCode}) says the app. Count what is left, or write down the pieces taken out.`,
          entityType: r.kind === "box" ? "container" : "location",
          entityId: r.kind === "box" ? r.containerId : r.locationId,
          link: r.kind === "box" ? `/inventory/take-out/count?box=${r.containerId}` : `/inventory/take-out/count?lot=${r.lotId}&location=${r.locationId}`,
          dedupeKey: r.kind === "box" ? `takeout.stale:box:${r.containerId}:${r.lastActivity.toISOString()}` : `takeout.stale:loose:${r.locationId}|${r.lotId}:${r.lastActivity.toISOString()}`,
        });
        stale += sent.length;
      }
      const day = await getSetting(db, org.id, "inventory.takeout.weekly_count_day", site.id);
      const boxes = mine.filter((r) => r.kind === "box");
      if (day !== 0 && day === weekday && boxes.length) {
        const sent = await notifyUsers(db, people, {
          organizationId: org.id,
          siteId: site.id,
          kind: "inventory.takeout.weekly_count",
          severity: "info",
          title: `Weekly count: ${boxes.length === 1 ? "1 open box" : `${boxes.length} open boxes`} at ${site.code}`,
          body: "Count what is left in each open box. A box that matches takes one tap; a difference goes to the site manager with a reason.",
          entityType: "site",
          entityId: site.id,
          link: "/inventory/take-out/count",
          dedupeKey: `takeout.weekly:${site.id}:${today}`,
        });
        weekly += sent.length;
      }
    }
  }
  return { stale, weekly };
}
