import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAINTENANCE_MESSAGE, maintenanceBlocks, maintenanceModeOn, maintenanceResponse } from "@/lib/maintenance-mode";

/** ADR-115 §4: MAINTENANCE_MODE=1 answers 503 for everything except the health checks. */
describe("MAINTENANCE_MODE switch", () => {
  it("is on only for the exact value 1", () => {
    expect(maintenanceModeOn("1")).toBe(true);
    for (const v of [undefined, null, "", "0", "true", "yes", " 1", "on"]) expect(maintenanceModeOn(v), String(v)).toBe(false);
  });

  it("blocks every path while on, except /api/health and /api/ready", () => {
    for (const p of ["/", "/login", "/dashboard", "/production/orders", "/api/v1/stock/movements", "/api/portal/v1/orders", "/print/bmr/x", "/api/health/worker", "/api/healthz", "/api/ready-test", "/sw.js"]) {
      expect(maintenanceBlocks(p, "1"), p).toBe(true);
    }
    for (const p of ["/api/health", "/api/ready", "/api/health/", "/api/ready/"]) expect(maintenanceBlocks(p, "1"), p).toBe(false);
  });

  it("blocks nothing while off", () => {
    for (const p of ["/", "/login", "/api/health", "/api/v1/stock/movements"]) {
      expect(maintenanceBlocks(p, undefined), p).toBe(false);
      expect(maintenanceBlocks(p, "0"), p).toBe(false);
    }
  });

  it("answers a plain 503 page with Retry-After, never cached", async () => {
    const r = maintenanceResponse();
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("300");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("Content-Type")).toMatch(/^text\/html/);
    const body = await r.text();
    expect(body).toContain("We are restoring the system. Please try again in a few minutes.");
    expect(body).toContain(MAINTENANCE_MESSAGE);
    expect(body).not.toMatch(/<script/i);
  });

  it("the middleware checks it first, reading the variable literally (Next.js passes it to the middleware at run time)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "middleware.ts"), "utf8");
    expect(src).toContain("maintenanceBlocks(req.nextUrl.pathname, process.env.MAINTENANCE_MODE)");
    expect(src.indexOf("maintenanceBlocks(")).toBeLessThan(src.indexOf("NextResponse.next("));
  });

  it("the health checks report the switch", () => {
    for (const f of ["health", "ready"]) {
      const src = readFileSync(join(__dirname, "..", "..", "src", "app", "api", f, "route.ts"), "utf8");
      expect(src, f).toContain("maintenanceModeOn(process.env.MAINTENANCE_MODE)");
    }
  });
});
