import { describe, expect, it } from "vitest";
import { NOT_REACHED, clearKept, fingerprint, keptKey, readKept, safeCall, writeKept } from "@/app/(app)/masterdata/recipes/wizard-keep";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("the wizard keeps what was typed until it is saved (ADR-116)", () => {
  const draft = { productId: "p1", lines: [{ materialId: "m1", amount: "60" }] };

  it("one key per person, kind and recipe", () => {
    expect(keptKey("u1", "new", null)).toBe("bc.recipe-wizard.v1:u1:new:new");
    expect(keptKey("u1", "edit", "f1")).not.toBe(keptKey("u2", "edit", "f1"));
  });

  it("writes and reads back the copy made from the same starting point", () => {
    const s = memory();
    const base = fingerprint({ productId: "" });
    writeKept(s, "k", base, 3, draft, new Date("2026-11-06T02:42:00Z"));
    expect(readKept(s, "k", base)).toMatchObject({ screen: 3, draft, savedAt: "2026-11-06T02:42:00.000Z" });
  });

  it("ignores a copy made from another starting point (the recipe changed on the server), and broken data", () => {
    const s = memory();
    writeKept(s, "k", fingerprint({ a: 1 }), 2, draft);
    expect(readKept(s, "k", fingerprint({ a: 2 }))).toBeNull();
    s.setItem("k", "{not json");
    expect(readKept(s, "k", "x")).toBeNull();
    expect(readKept(null, "k", "x")).toBeNull();
  });

  it("clears after a successful save; a full storage never throws", () => {
    const s = memory();
    writeKept(s, "k", "b", 1, draft);
    clearKept(s, "k");
    expect(readKept(s, "k", "b")).toBeNull();
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => writeKept(full, "k", "b", 1, draft)).not.toThrow();
    expect(() => clearKept(full, "k")).not.toThrow();
  });

  it("a server call that throws becomes a plain failed result (no error screen, nothing lost)", async () => {
    expect(await safeCall(async () => { throw new TypeError("Failed to fetch"); })).toEqual({ ok: false, message: NOT_REACHED });
    expect(await safeCall(async () => undefined as unknown as { ok: boolean })).toEqual({ ok: false, message: NOT_REACHED });
    expect(await safeCall(async () => ({ ok: true, message: "Saved." }))).toEqual({ ok: true, message: "Saved." });
  });
});
