/**
 * US-2-21 export layer and US-2-22 command contract against a real database:
 * authz.cross_site.export, authz.sensitive_fields.masked, platform.export.created audit, the row
 * cap (A-PM-17 setting), idempotency.key_required_on_postings, replay / reuse / cross-site /
 * permission handling of the /api/v1 pipeline.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, settings, stockMovements } from "@/db/schema";
import { commands } from "@/lib/api/contract";
import { executeCommand } from "@/lib/api/server";
import type { AuthContext } from "@/lib/auth/context";
import { type ExportDefinition, runExport } from "@/lib/export";
import { availabilityExport, stockCardExport } from "@/modules/inventory/exports";
import { transferStock } from "@/modules/inventory/movements";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot, onHand } from "../../support/kit";

let kit: Kit;
let wh: AuthContext;
let whRvs: AuthContext;
let sales: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
});

const csvText = (b: Buffer) => b.toString("utf8").replace(/^﻿/, "");

describe("export layer", () => {
  it("authz.cross_site.export: a Site A user asking for Site B gets not_found; Site A rows only, scope in the audit", async () => {
    const fg = await loc(kit.rvs.id, "FG-01");
    const rvsLot = await makeLot(whRvs, kit.rvs.id, fg.id, "77");
    await expectCode(runExport(wh, availabilityExport, { siteId: kit.rvs.id }, "csv"), "not_found");
    const file = await runExport(wh, availabilityExport, { siteId: kit.nfd.id }, "csv");
    const text = csvText(file.body);
    expect(text).not.toContain(rvsLot.lotNumber);
    expect(text).toContain('"Site filter","NFD"');
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.export.created"), eq(auditEvents.actorId, wh.userId)));
    expect(ev.after).toMatchObject({ code: "inventory.availability", format: "csv", siteScope: [kit.nfd.id], rowCount: file.rowCount, sha256: file.sha256 });
  });

  it("requires the module .export permission (sales_cs holds balance.view but not balance.export)", async () => {
    await expectCode(runExport(sales, availabilityExport, { siteId: kit.nfd.id }, "csv"), "forbidden");
  });

  it("authz.sensitive_fields.masked: a column the caller may not see is absent and named in the header", async () => {
    type Row = { code: string; price: string };
    const def: ExportDefinition<{ siteId: string }, Row> = {
      code: "test.masked",
      title: "Masked test",
      permission: "inventory.balance.export",
      sensitivity: "N",
      siteScope: (_c, f) => [f.siteId],
      fileName: () => "masked",
      fetch: async () => [{ code: "=HYPERLINK(\"x\")", price: "68.00" }],
      columns: [
        { header: "Code", value: (r) => r.code },
        { header: "Unit price", value: (r) => r.price, requires: "sales.sales_order.approve" },
      ],
    };
    const file = await runExport(wh, def, { siteId: kit.nfd.id }, "csv");
    const text = csvText(file.body);
    expect(text).not.toContain("68.00");
    expect(text).not.toContain('"Unit price"\r');
    expect(text).toContain('"Masked columns","Unit price"');
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(file.maskedColumns).toEqual(["Unit price"]);
  });

  it("refuses more rows than platform.export.max_rows and restricted (R) exports without re-authentication", async () => {
    const [row] = await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "platform.export.max_rows", value: 1 }).returning();
    try {
      await expectCode(runExport(wh, availabilityExport, { siteId: kit.nfd.id }, "xlsx"), "too_large");
    } finally {
      await db.delete(settings).where(eq(settings.id, row.id));
    }
    await expectCode(runExport(wh, { ...availabilityExport, sensitivity: "R" }, { siteId: kit.nfd.id }, "csv"), "reauth_required");
  });

  it("the stock card exports as XLSX with string cells only", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "10");
    const file = await runExport(wh, stockCardExport, { lotId: lot.id, from: "2026-01-01", to: "2030-12-31" }, "xlsx");
    expect(file.body.subarray(0, 2).toString()).toBe("PK");
    expect(file.rowCount).toBeGreaterThanOrEqual(3);
  });
});

describe("/api/v1 command pipeline", () => {
  const env = <T,>(payload: T, siteId = kit.nfd.id) => ({ commandId: uuidv7(), siteId, payload });

  it("idempotency.key_required_on_postings: every idempotent command without Idempotency-Key is 422", async () => {
    for (const c of Object.values(commands).filter((c) => c.idempotent)) {
      const r = await executeCommand(c, wh, { body: env({}), idempotencyKey: null }, async () => ({}));
      expect(r.status, c.name).toBe(422);
      expect(r.body).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
    }
    const t = commands.transferStock;
    const r = await executeCommand(t, wh, { body: env({ lotId: randomUUID(), fromLocationId: randomUUID(), toLocationId: randomUUID(), qty: "1", reason: "test" }), idempotencyKey: null }, async () => ({}));
    expect(r.body).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
  });

  it("a repeat with the same key replays the stored response and posts once; same key + different body is 422", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "100");
    const key = randomUUID();
    const body = env({ lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "10", reason: "api move" });
    const handler = (ctx: AuthContext, p: { lotId: string; fromLocationId: string; toLocationId: string; qty: string; reason: string }, meta: { idempotencyKey: string }) =>
      transferStock(ctx, { ...p, idempotencyKey: meta.idempotencyKey });
    const first = await executeCommand(commands.transferStock, wh, { body, idempotencyKey: key }, handler);
    expect(first.status).toBe(200);
    const again = await executeCommand(commands.transferStock, wh, { body, idempotencyKey: key }, handler);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers?.["Idempotent-Replayed"]).toBe("true");
    expect(await onHand(lot.id, a02.id)).toBe("10");
    const [n] = await db.select({ n: count() }).from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "transfer")));
    expect(n.n).toBe(1);
    const reused = await executeCommand(commands.transferStock, wh, { body: { ...body, payload: { ...body.payload, qty: "11" } }, idempotencyKey: key }, handler);
    expect(reused).toMatchObject({ status: 422, body: { error: { code: "IDEMPOTENCY_KEY_REUSED" } } });
  });

  it("concurrent duplicates with one key produce one ledger row", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "100");
    const key = randomUUID();
    const body = env({ lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "5", reason: "double tap" });
    const results = await Promise.all(
      [1, 2, 3].map(() => executeCommand(commands.transferStock, wh, { body, idempotencyKey: key }, (ctx, p, meta) => transferStock(ctx, { ...p, idempotencyKey: meta.idempotencyKey }))),
    );
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await onHand(lot.id, a02.id)).toBe("5");
  });

  it("unauthenticated → 401; missing permission → 403; another site in the envelope → 404; business refusal → 409 STOCK_INSUFFICIENT", async () => {
    const noop = async () => ({});
    expect((await executeCommand(commands.retryJob, null, { body: env({ jobId: randomUUID() }), idempotencyKey: randomUUID() }, noop)).status).toBe(401);
    expect(await executeCommand(commands.retryJob, wh, { body: env({ jobId: randomUUID() }), idempotencyKey: randomUUID() }, noop)).toMatchObject({ status: 403, body: { error: { code: "PERMISSION_DENIED" } } });
    expect(await executeCommand(commands.acknowledgeNotification, wh, { body: env({ notificationId: randomUUID() }, kit.rvs.id), idempotencyKey: randomUUID() }, noop)).toMatchObject({ status: 404 });
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "3");
    const r = await executeCommand(
      commands.transferStock,
      wh,
      { body: env({ lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "9", reason: "too much" }), idempotencyKey: randomUUID() },
      (ctx, p, meta) => transferStock(ctx, { ...p, idempotencyKey: meta.idempotencyKey }),
    );
    expect(r).toMatchObject({ status: 409, body: { ok: false, error: { code: "STOCK_INSUFFICIENT" } } });
  });

  it("rejects an envelope without a client UUIDv7 command id or with unknown fields", async () => {
    const noop = async () => ({});
    const bad = await executeCommand(commands.acknowledgeNotification, wh, { body: { commandId: randomUUID(), siteId: kit.nfd.id, payload: { notificationId: randomUUID() } }, idempotencyKey: randomUUID() }, noop);
    expect(bad.status).toBe(422);
    const extra = await executeCommand(commands.acknowledgeNotification, wh, { body: { ...env({ notificationId: randomUUID() }), sneaky: 1 }, idempotencyKey: randomUUID() }, noop);
    expect(extra.status).toBe(422);
  });
});
