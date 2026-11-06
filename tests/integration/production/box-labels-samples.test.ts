/**
 * ADR-110 C6 (end-to-end walk P11): the box labels printed on the packaging step leave out the retained samples QA
 * keeps, so Finish (good − samples) accepts them first time. Read rules: another site cannot see the box card.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { batchBoxInfoFor } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";

let kit: Kit;
let operator: AuthContext;
let operatorRvs: AuthContext;
let batchId: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  [{ id: batchId }] = await db.select({ id: batches.id }).from(batches).where(eq(batches.batchNumber, "B-26-0004"));
}, 180_000);

describe("C6 box labels at the packaging step leave out the samples", () => {
  it("the default to box is the expected pieces minus the samples QA keeps (setting, default 2)", async () => {
    const info = await batchBoxInfoFor(operator, batchId);
    expect(info.samples).toBe(2);
    expect(info.plan).toBeNull();
    expect(info.defaultPieces).toBe(info.expectedPieces - 2);
  });

  it("another site cannot read the box card", async () => {
    await expectCode(batchBoxInfoFor(operatorRvs, batchId), "not_found");
  });
});
