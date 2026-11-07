/**
 * Equipment (machine) fields are scan fields (docs/SCAN_INPUTS.md, ADR-125): `<ScanOrPick kind="equipment">` takes a
 * scanned `BC:EQP:` label, the machine number typed (any case, with or without dashes) or a tap in the list. The
 * server resolves it inside the caller's organisation and current site, refuses labels of another kind, other sites'
 * machines and callers without an equipment permission. Fictional seed data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { equipment } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { findPickCandidates, resolvePickRef } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";

let kit: Kit;
let operator: AuthContext;
let tech: AuthContext;
let nobody: AuthContext;
let rvsCode: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  tech = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  nobody = await asUser(kit, "floor.nfd@bryels-care.test", ["no_such_role"], [kit.nfd]);
  rvsCode = "MIX-91";
  await db.insert(equipment).values({ organizationId: kit.orgId, siteId: kit.rvs.id, code: rvsCode, name: "Test mixer at the other site (fictional)", equipmentKind: "mixer" });
}, 180_000);

describe("equipment as a ScanOrPick kind", () => {
  it("resolves a BC:EQP label, the code typed loosely, and the id; the candidate submits the id with the code as label code", async () => {
    const a = await resolvePickRef(operator, "equipment", "BC:EQP:SC-01");
    expect(a).toMatchObject({ code: "SC-01", codes: ["SC-01"] });
    expect(a.title).toMatch(/scale/i);
    expect((await resolvePickRef(operator, "equipment", "sc01")).value).toBe(a.value);
    expect((await resolvePickRef(operator, "equipment", "mix-01")).code).toBe("MIX-01");
    expect((await resolvePickRef(operator, "equipment", a.value)).code).toBe("SC-01");
  });

  it("finds machines by name at the current site only", async () => {
    const r = await findPickCandidates(operator, "equipment", "mixer");
    expect(r.map((c) => c.code).sort()).toEqual(["MIX-01", "MIX-02"]);
    expect(r.find((c) => c.code === "MIX-02")?.detail).toMatch(/out of service/);
    expect(await findPickCandidates(operator, "equipment", "other site")).toEqual([]);
  });

  it("refuses another site's machine, a label of another kind, the placeholder and a caller without equipment permission", async () => {
    await expectCode(resolvePickRef(operator, "equipment", rvsCode), "not_found");
    await expectCode(resolvePickRef(operator, "equipment", `BC:EQP:${rvsCode}`), "not_found");
    const wrong = await expectCode(resolvePickRef(operator, "equipment", "BC:LOT:L-2610-00001"), "validation");
    expect(wrong.message).toMatch(/lot label/);
    await expectCode(resolvePickRef(operator, "equipment", "BC:EQP:…"), "validation");
    await expectCode(resolvePickRef(nobody, "equipment", "SC-01"), "forbidden");
    await expectCode(findPickCandidates(nobody, "equipment", "scale"), "forbidden");
    // A site manager (maintenance jobs) resolves the same machines.
    expect((await resolvePickRef(tech, "equipment", "cut01")).code).toBe("CUT-01");
  });
});
