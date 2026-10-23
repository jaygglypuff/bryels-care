/**
 * US-2-22 contract snapshot (docs-sync): the committed docs/api/v1-contract.json equals the
 * contract in code; every contract entry has its route file; every posting is idempotent with a
 * strict payload; offline eligibility is declared (docs/process-maps.md §6).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandEnvelope, commands, contractDocument, queries } from "@/lib/api/contract";
import { buildCommandRequest, queryUrl } from "@/lib/api/client";

const root = path.resolve(__dirname, "../..");
const routeFile = (p: string) => path.join(root, "src/app", p.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");

describe("api contract", () => {
  it("docs/api/v1-contract.json is up to date (run pnpm api:contract)", () => {
    const committed = JSON.parse(readFileSync(path.join(root, "docs/api/v1-contract.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(contractDocument())));
  });

  it("every command and query has its route file exporting the method", () => {
    for (const c of [...Object.values(commands), ...Object.values(queries)]) {
      const f = routeFile(c.path);
      expect(existsSync(f), `${c.name} → ${f}`).toBe(true);
      expect(readFileSync(f, "utf8")).toContain(`export const ${c.method} =`);
    }
  });

  it("names and paths are unique; commands are POST under /api/v1; every posting is idempotent", () => {
    const all = [...Object.values(commands), ...Object.values(queries)];
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(new Set(all.map((c) => `${c.method} ${c.path}`)).size).toBe(all.length);
    for (const c of Object.values(commands)) {
      expect(c.path.startsWith("/api/v1/")).toBe(true);
      expect(c.idempotent).toBe(true);
      expect(["queueable", "online_only"]).toContain(c.offline);
    }
  });

  it("payloads are strict and the envelope requires a client UUIDv7 command id", () => {
    for (const c of Object.values(commands)) expect(c.payload.safeParse({ __unknown: 1 }).success, c.name).toBe(false);
    const env = commandEnvelope(commands.acknowledgeNotification.payload);
    const site = "0199f6a2-1c2b-7d3e-8f40-123456789abc";
    const ok = env.safeParse({ commandId: "0199f6a2-1c2b-7d3e-8f40-123456789abd", siteId: site, payload: { notificationId: site } });
    expect(ok.success).toBe(true);
    const v4 = env.safeParse({ commandId: "3b241101-e2bb-4255-8caf-4136c566a962", siteId: site, payload: { notificationId: site } });
    expect(v4.success).toBe(false);
  });

  it("the typed client builds the documented envelope and fills path parameters", () => {
    const r = buildCommandRequest("transferStock", { lotId: "a", fromLocationId: "b", toLocationId: "c", qty: "1", reason: "move" }, { siteId: "s", deviceId: "dev-1" });
    expect(r.url).toBe("/api/v1/inventory/movements/transfer");
    expect(r.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body).toMatchObject({ siteId: "s", deviceId: "dev-1", payload: { qty: "1" } });
    expect(r.body.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(queryUrl("stockCard", { lotId: "L1", from: "2026-01-01", to: "2026-01-31" })).toBe("/api/v1/inventory/lots/L1/stock-card?from=2026-01-01&to=2026-01-31");
  });
});
