import "server-only";
import type { Tx } from "@/db/client";
import { putAwayHintForLot } from "@/modules/inventory";
import { notifyUsers, usersForJob } from "@/modules/platform/notifications";
import { MessageTitle } from "@/lib/message-titles";

/** Round 5 (ADR-129): put-away is the warehouse's job (A report B10, C report B15); same roles as HANDOFFS.put_away. */
export const PUT_AWAY_JOB_ROLES: readonly string[] = ["warehouse_operator"];

/**
 * QA release → warehouse hand-off (usability test 2026-10-30): when QA releases a lot whose stock still
 * waits in a quarantine, hold or receiving place, the warehouse people of THAT site are told
 * "Put the Coconut Oil (lot …0024) on shelf A-01" (ADR-132 §3), with a link to Put away. Round 5: only the warehouse
 * (holders of inventory.movement.post with the warehouse role at that site); when the site has no warehouse person,
 * everyone who may move stock there, as before. The message clears itself once the lot is on a shelf
 * (notification-done.ts). Called inside the release transaction, so the message exists only if the release commits.
 * Once per lot (dedupe key per lot and recipient); the person who released it is not told.
 */
export async function notifyLotReadyForPutAway(tx: Tx, actorUserId: string, lotId: string): Promise<string[]> {
  const hint = await putAwayHintForLot(tx, lotId);
  if (!hint) return [];
  const people = (await usersForJob(tx, hint.organizationId, "inventory.movement.post", hint.siteId, PUT_AWAY_JOB_ROLES)).filter((u) => u !== actorUserId);
  return notifyUsers(tx, people, {
    organizationId: hint.organizationId,
    siteId: hint.siteId,
    kind: "inventory.lot.ready_to_put_away",
    severity: "info",
    title: MessageTitle.putAway(hint.itemName, hint.lotNumber, hint.suggestedCode),
    body: `Lot ${hint.lotNumber}: QA released it. It is waiting in ${hint.fromCodes.join(", ")}. ${hint.suggestedCode ? `Take it to ${hint.suggestedCode}.` : "Take it to a storage shelf."} Open Put away to move it.`,
    entityType: "inventory_lot",
    entityId: hint.lotId,
    link: "/inventory/receive/put-away",
    dedupeKey: `lot-ready-put-away:${hint.lotId}`,
  });
}
