/**
 * US-2-30 read-only maintenance mode (docs/testing.md §5.2): platform.read_only_mode_blocks_writes,
 * platform.read_only_mode_allow_list; the toggle is a `platform.setting.changed` event whose id the
 * cutover record cites; reads keep working.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, settings } from "@/db/schema";
import { commands } from "@/lib/api/contract";
import { executeCommand } from "@/lib/api/server";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { toActionState } from "@/lib/errors";
import { changeSetting } from "@/modules/governance";
import { listLots } from "@/modules/inventory";
import { postMovement } from "@/modules/inventory/ledger";
import { inventoryReconcileJob } from "@/modules/inventory/jobs";
import { enqueueJob } from "@/modules/platform/jobs";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let auditEventId: string | null;

const userId = async (email: string) => (await db.query.users.findFirst({ where: (u, { eq: e }) => e(u.email, email) }))!.id;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
});

afterAll(async () => {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "platform.maintenance.read_only")));
});

describe("read-only maintenance mode", () => {
  it("is switched on through the settings service with re-authentication and an auditable event", async () => {
    await expectCode(changeSetting(admin, { key: "platform.maintenance.read_only", siteId: null, value: { enabled: true, allowed_role_codes: ["qa_qc"] }, reason: "Cutover load window" }, null), "reauth_required");
    const r = await changeSetting(admin, { key: "platform.maintenance.read_only", siteId: null, value: { enabled: true, allowed_role_codes: ["qa_qc"] }, reason: "Cutover load window T0" }, "demo1234");
    expect(r.status).toBe("applied");
    auditEventId = r.status === "applied" ? r.auditEventId : null;
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.id, auditEventId!));
    expect(ev).toMatchObject({ action: "platform.setting.changed", entityNumber: "platform.maintenance.read_only" });
    expect(ev.after).toEqual({ value: { enabled: true, allowed_role_codes: ["qa_qc"] } });
  });

  it("platform.read_only_mode_blocks_writes: commands, postings and job enqueues are refused before any write; reads work", async () => {
    const wh = (await buildContextForUser(await userId("warehouse.nfd@bryels-care.test"), kit.nfd.id))!;
    expect(wh.readOnly).toBe(true);
    expect(() => wh.require("inventory.lot.view")).not.toThrow();
    expect(() => wh.require("inventory.movement.post")).toThrow(/Read-only for maintenance/);
    expect((await listLots(wh, {})).length).toBeGreaterThan(0);

    // The form message a server action shows (X state).
    const state = toActionState((() => {
      try {
        wh.require("inventory.movement.post");
      } catch (e) {
        return e;
      }
    })());
    expect(state).toMatchObject({ ok: false, message: expect.stringMatching(/Read-only for maintenance/) });

    // The stock ledger refuses as well (backstop for services that check only view permissions).
    const a01 = await loc(kit.nfd.id, "A-01");
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "receipt", lotId: randomUUID(), toLocationId: a01.id, qtyBase: "1" })), "read_only");

    // /api/v1: 503 READ_ONLY_MODE before the idempotency key is reserved.
    const res = await executeCommand(commands.transferStock, wh, { body: { commandId: uuidv7(), siteId: kit.nfd.id, payload: { lotId: randomUUID(), fromLocationId: a01.id, toLocationId: a01.id, qty: "1", reason: "x" } }, idempotencyKey: randomUUID() }, async () => {
      throw new Error("must not run");
    });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, error: { code: "READ_ONLY_MODE" } });

    // Jobs on behalf of the user.
    const manager = (await buildContextForUser(await userId("manager.nfd@bryels-care.test"), kit.nfd.id))!;
    await expectCode(enqueueJob(db, manager, inventoryReconcileJob, { siteId: kit.nfd.id, asOf: new Date().toISOString(), trigger: "manual" }, { siteId: kit.nfd.id }), "read_only");
  });

  it("platform.read_only_mode_allow_list: allow-listed roles write normally", async () => {
    const qa = (await buildContextForUser(await userId("qa.nfd@bryels-care.test"), kit.nfd.id))!;
    expect(qa.readOnly).toBe(false);
    expect(() => qa.require("quality.hold.create")).not.toThrow();
    const a01 = await loc(kit.nfd.id, "A-01");
    // A qa_qc user may post (here: the fixture receipt through the ledger).
    const sys = await asUser(kit, "qa.nfd@bryels-care.test", ["qa_qc", "warehouse_operator"], [kit.nfd], { readOnly: false });
    const lot = await makeLot(sys, kit.nfd.id, a01.id, "5");
    expect(lot.id).toBeTruthy();
  });

  it("switching it off restores writes for everyone", async () => {
    await changeSetting(admin, { key: "platform.maintenance.read_only", siteId: null, value: { enabled: false, allowed_role_codes: [] }, reason: "Cutover complete" }, "demo1234");
    const wh = (await buildContextForUser(await userId("warehouse.nfd@bryels-care.test"), kit.nfd.id))!;
    expect(wh.readOnly).toBe(false);
    expect(() => wh.require("inventory.movement.post")).not.toThrow();
  });
});
