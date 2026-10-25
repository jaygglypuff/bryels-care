/**
 * Wave 4 W4D fictional demo data (offline operation; runs inside the ALLOW_DEMO_SEED-guarded seed):
 * three device registrations at NFD (an active weighing tablet, a pending counting phone, a removed
 * old phone) and one open sync conflict, so Admin › Devices and the conflict review queue show real
 * rows in the demo. The device keys are random and never leave this seed (no browser holds them):
 * a demo user registers their own browser from the Sync page.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;
const keyHash = () => createHash("sha256").update(`device:${randomBytes(32).toString("base64url")}`).digest("hex");

export async function seedW4d(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const manager = await user("manager.nfd@bryels-care.test");
  const warehouse = await user("warehouse.nfd@bryels-care.test");
  const operator = await user("operator.nfd@bryels-care.test");
  if (!nfd || !manager || !warehouse || !operator) return;
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);

  // 1. Devices: an approved weighing tablet, a counting phone waiting for approval, a removed phone.
  await db.insert(s.deviceRegistrations).values([
    {
      organizationId: O,
      siteId: nfd.id,
      deviceKeyHash: keyHash(),
      label: "Weighing tablet 1 (demo)",
      platform: "android",
      browser: "Chrome",
      deviceClass: "managed_tablet",
      isManaged: true,
      status: "active",
      allowedOfflineWorkflows: ["dispensing", "stock_count"],
      requestedBy: operator.id,
      requestedAt: at(72),
      registeredBy: manager.id,
      registeredAt: at(71),
      lastSeenAt: at(2),
      lastSyncAt: at(2),
      lastReferenceRefreshAt: at(5),
      statusChangedAt: at(71),
      statusChangedBy: manager.id,
    },
    {
      organizationId: O,
      siteId: nfd.id,
      deviceKeyHash: keyHash(),
      label: "Counting phone 2 (demo)",
      platform: "android",
      browser: "Chrome",
      deviceClass: "floor_shared",
      status: "pending",
      requestedBy: warehouse.id,
      requestedAt: at(3),
      statusChangedAt: at(3),
      statusChangedBy: warehouse.id,
    },
    {
      organizationId: O,
      siteId: nfd.id,
      deviceKeyHash: keyHash(),
      label: "Old scanner phone (demo)",
      platform: "android",
      deviceClass: "floor_shared",
      status: "removed",
      requestedBy: warehouse.id,
      requestedAt: at(400),
      registeredBy: manager.id,
      registeredAt: at(399),
      statusChangedAt: at(100),
      statusChangedBy: manager.id,
      statusReason: "Screen broken; replaced (demo)",
      removedAt: at(100),
      removedBy: manager.id,
      removedReason: "Screen broken; replaced (demo)",
    },
  ]);

  // 2. One open conflict: a stock move queued offline from an unregistered browser for more than the
  //    loose stock at the source, refused on replay (insufficient stock), waiting for the site manager.
  const [bal] = await db
    .select({ lotId: s.inventoryBalances.lotId, locationId: s.inventoryBalances.locationId, qty: s.inventoryBalances.qtyBase, lotNumber: s.inventoryLots.lotNumber, status: s.inventoryLots.qualityStatus, baseUom: s.inventoryLots.baseUom })
    .from(s.inventoryBalances)
    .innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.inventoryBalances.lotId))
    .innerJoin(s.locations, eq(s.locations.id, s.inventoryBalances.locationId))
    .where(and(eq(s.inventoryBalances.siteId, nfd.id), eq(s.locations.code, "A-01"), gt(s.inventoryBalances.qtyBase, "0")))
    .orderBy(desc(s.inventoryBalances.qtyBase))
    .limit(1);
  const [a02] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, "A-02")));
  if (!bal || !a02) return;
  const wanted = (Number(bal.qty) + 5000).toFixed(0);
  const commandId = uuidv7();
  const created = at(6);
  const message = `Only ${Number(bal.qty)} ${bal.baseUom} of lot ${bal.lotNumber} is at A-01; the move asked for ${wanted}. (demo)`;
  const payload = { lotId: bal.lotId, fromLocationId: bal.locationId, toLocationId: a02.id, qty: wanted, reason: "Move to rack A-02 (queued offline, demo)" };
  await db.insert(s.syncCommands).values({
    id: commandId,
    organizationId: O,
    siteId: nfd.id,
    userId: warehouse.id,
    commandType: "inventory.movement.transfer",
    payload,
    idempotencyKey: crypto.randomUUID(),
    clientCreatedAt: created,
    authSnapshotIssuedAt: at(7),
    receivedAt: at(1),
    syncBatchId: uuidv7(),
    replayedAt: at(1),
    status: "conflict",
    errorCode: "STOCK_INSUFFICIENT",
    errorMessage: message,
    correlationId: uuidv7(),
  });
  await db.insert(s.syncConflicts).values({
    organizationId: O,
    siteId: nfd.id,
    syncCommandId: commandId,
    userId: warehouse.id,
    commandType: "inventory.movement.transfer",
    reasonCode: "insufficient_stock",
    reasonMessage: message,
    clientState: { type: "inventory.movement.transfer", payload, clientCreatedAt: created.toISOString() },
    serverState: { qualityStatus: bal.status, onHandAtSource: bal.qty, baseUom: bal.baseUom },
    relatedEntityType: "inventory_lot",
    relatedEntityId: bal.lotId,
    relatedEntityNumber: bal.lotNumber,
    createdAt: at(1),
  });
}
