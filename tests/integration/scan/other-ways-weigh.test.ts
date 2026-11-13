/**
 * ADR-133 item 3 (ADR-126 open point): the "Other ways" weigh form of the batch workspace (`dispenseAction`) sends how
 * the lot was given (`lotVia`), so `scan.typed_code_counts_as_check` off reaches it and the main Weigh's lot rules apply:
 * a typed number is refused while typing is off; a lot tapped in the list (or a form that does not say how) needs the
 * lot confirmed like the main Weigh (`production.weighing.lot_confirm`); a scan is the confirmation. Fictional data.
 */
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, dispenseRecords, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { TYPING_IS_OFF } from "@/lib/scan/code-sql";
import { createBatch, startBatch } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, loadKit, type Kit } from "../../support/kit";
import { setTestCookies } from "../../support/next-headers";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, signChecklist, snapshotOf } from "../../support/w2b";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;

async function setOrg(key: string, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, key), isNull(settings.siteId)));
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key, value });
}
async function clearOrg(key: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, key), isNull(settings.siteId)));
}

async function batchReadyToWeigh() {
  const { batchId } = await createBatch(manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  await cleanEquipment(operator, "SC-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  await signChecklist(operator, checker, batchId, [...snapshotOf(b).steps].sort((x, y) => x.stepNo - y.stepNo)[0]);
  const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
  return { batchId, coconut: lines[0], palm: lines[1], coconutLot: (await lotBySupplierLot("LOS-24871")).lotNumber, palmLot: (await lotBySupplierLot("MPC-7731")).lotNumber };
}

/** The form as the "Other ways" weigh card posts it (ScanOrPick submit="code" viaName="lotVia"). */
function otherWaysForm(batchId: string, batchMaterialId: string, lotRef: string, via: string | null, qty: string) {
  const fd = new FormData();
  fd.set("batchId", batchId);
  fd.set("batchMaterialId", batchMaterialId);
  fd.set("lotRef", lotRef);
  if (via) fd.set("lotVia", via);
  fd.set("qty", qty);
  fd.set("uom", "g");
  fd.set("equipmentRef", "SC-01");
  fd.set("idempotencyKey", uuidv7());
  return fd;
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  await allowDirectBatches(kit);
  const { token } = await createSessionRecord({ userId: operator.userId });
  setTestCookies({ bc_session: token });
}, 240_000);

afterEach(async () => {
  await clearOrg("scan.typed_code_counts_as_check");
  await clearOrg("production.weighing.lot_confirm");
});

const recordedVia = async (batchMaterialId: string) => {
  const recs = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, batchMaterialId));
  return Promise.all(recs.map(async (r) => ((await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.dispense_record.recorded"), eq(auditEvents.entityId, r.id))))[0].after as { lotConfirmed: string }).lotConfirmed));
};

describe('"Other ways" weigh form sends how the lot was given', () => {
  it("typing off: a typed lot number is refused; a tap or a form without lotVia needs the lot confirmed; a scan saves", async () => {
    const { dispenseAction } = await import("@/app/(app)/production/[batchId]/actions");
    const w = await batchReadyToWeigh();
    await setOrg("scan.typed_code_counts_as_check", false);
    const typed = await dispenseAction(null as never, otherWaysForm(w.batchId, w.coconut.id, w.coconutLot, "typed", "3723.2"));
    expect(typed).toMatchObject({ ok: false, message: TYPING_IS_OFF });
    const tapped = await dispenseAction(null as never, otherWaysForm(w.batchId, w.coconut.id, w.coconutLot, "tap", "3723.2"));
    expect(tapped.ok).toBe(false);
    expect(tapped.message).toMatch(/Tapping the list does not confirm the lot/);
    const noVia = await dispenseAction(null as never, otherWaysForm(w.batchId, w.coconut.id, w.coconutLot, null, "3723.2"));
    expect(noVia.ok).toBe(false);
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, w.coconut.id))).toHaveLength(0);
    const scanned = await dispenseAction(null as never, otherWaysForm(w.batchId, w.coconut.id, `BC:LOT:${w.coconutLot}`, "scan", "3723.2"));
    expect(scanned, JSON.stringify(scanned)).toMatchObject({ ok: true });
    expect(await recordedVia(w.coconut.id)).toEqual(["scan"]);
  });

  it("typing on (default): the typed lot number counts and is recorded as typed", async () => {
    const { dispenseAction } = await import("@/app/(app)/production/[batchId]/actions");
    const w = await batchReadyToWeigh();
    const r = await dispenseAction(null as never, otherWaysForm(w.batchId, w.coconut.id, w.coconutLot.toLowerCase(), "typed", "3723.2"));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(await recordedVia(w.coconut.id)).toEqual(["typed"]);
  });

  it('lot confirmation set to "none": a tapped lot is enough, as on the main Weigh', async () => {
    const { dispenseAction } = await import("@/app/(app)/production/[batchId]/actions");
    const w = await batchReadyToWeigh();
    await setOrg("production.weighing.lot_confirm", "none");
    const r = await dispenseAction(null as never, otherWaysForm(w.batchId, w.coconut.id, w.coconutLot, "tap", "3723.2"));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(await recordedVia(w.coconut.id)).toEqual(["not_required"]);
  });
});
