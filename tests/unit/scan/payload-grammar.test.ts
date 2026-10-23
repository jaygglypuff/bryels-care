import { describe, expect, it } from "vitest";
import { buildPayload, isValidScanValue, parseScan, SCAN_PAYLOAD_RE } from "@/lib/scan/payload";
import { createDuplicateGuard, createFlowScanSet, isTerminatorKey } from "@/lib/scan/dedupe";
import { createRateLimiter } from "@/lib/scan/rate-limit";

describe("scan.payload_grammar (ADR-017, docs/data-model.md §9.5)", () => {
  it("accepts every typed payload with a grammar-valid value", () => {
    for (const t of ["LOT", "BOX", "LOC", "MAT", "SKU", "EQP", "DOC"]) {
      const p = parseScan(`BC:${t}:A-1.2_3`);
      expect(p).toEqual({ kind: "typed", type: t, value: "A-1.2_3", payload: `BC:${t}:A-1.2_3` });
    }
    expect(parseScan("BC:LOT:L-2610-00042")).toMatchObject({ kind: "typed", type: "LOT", value: "L-2610-00042" });
  });

  it("normalises wedge noise and case but keeps the grammar", () => {
    expect(parseScan("  bc:lot:l-2610-00042\r\n")).toMatchObject({ kind: "typed", type: "LOT", value: "L-2610-00042" });
    expect(parseScan("\u001dBC:LOC:QUA-01\t")).toMatchObject({ kind: "typed", type: "LOC", value: "QUA-01" });
  });

  it("treats a bare grammar-valid value as an untyped manual entry", () => {
    expect(parseScan("B-26-0001")).toEqual({ kind: "untyped", value: "B-26-0001" });
  });

  it("rejects unknown types, bad values, overlong values and empty input", () => {
    expect(parseScan("BC:XYZ:1")).toMatchObject({ kind: "invalid", reason: "grammar" });
    expect(parseScan("BC:LOT:")).toMatchObject({ kind: "invalid" });
    expect(parseScan("BC:LOT:-ABC")).toMatchObject({ kind: "invalid" });
    expect(parseScan("BC:LOT:A B")).toMatchObject({ kind: "invalid" });
    expect(parseScan("BC:LOT:L:1")).toMatchObject({ kind: "invalid" });
    expect(parseScan(`BC:LOT:${"A".repeat(65)}`)).toMatchObject({ kind: "invalid" });
    expect(parseScan(`BC:LOT:${"A".repeat(64)}`)).toMatchObject({ kind: "typed" });
    expect(parseScan("   ")).toMatchObject({ kind: "invalid", reason: "empty" });
    expect(parseScan("LOT 42")).toMatchObject({ kind: "invalid", reason: "grammar" });
  });

  it("scan.rejects_url: a web link is never followed or looked up", () => {
    expect(parseScan("https://evil.example/BC:LOT:L-1")).toMatchObject({ kind: "invalid", reason: "url" });
    expect(parseScan("http://10.0.0.1/lots/1")).toMatchObject({ kind: "invalid", reason: "url" });
    expect(parseScan("www.example.com")).toMatchObject({ kind: "invalid", reason: "url" });
    expect(parseScan("BC:LOT:https://x")).toMatchObject({ kind: "invalid", reason: "url" });
  });

  it("buildPayload refuses values a label must never encode", () => {
    expect(buildPayload("LOT", "L-2610-00042")).toBe("BC:LOT:L-2610-00042");
    expect(() => buildPayload("LOT", "l-1")).toThrow();
    expect(() => buildPayload("LOC", "A/1")).toThrow();
    expect(isValidScanValue("DOC-26-0000001")).toBe(true);
    expect(SCAN_PAYLOAD_RE.test("BC:DOC:DOC-26-0000001")).toBe(true);
  });
});

describe("duplicate scans (US-2-13 AC2)", () => {
  it("ignores the same payload within 2 s and accepts it after", () => {
    let t = 0;
    const g = createDuplicateGuard(2000, () => t);
    expect(g.accept("BC:LOT:L-1")).toBe(true);
    t = 500;
    expect(g.accept("BC:LOT:L-1")).toBe(false);
    t = 1500;
    expect(g.accept("BC:LOT:L-2")).toBe(true);
    t = 1600;
    expect(g.accept("BC:LOT:L-1")).toBe(true);
    t = 4000;
    expect(g.accept("BC:LOT:L-1")).toBe(true);
  });

  it("flags a repeat in the same flow so the UI can ask 'Already scanned. Scan it again?'", () => {
    const f = createFlowScanSet();
    expect(f.check("BC:BOX:C-1")).toBe("new");
    f.accept("BC:BOX:C-1");
    expect(f.check("BC:BOX:C-1")).toBe("repeat");
    expect(f.count("BC:BOX:C-1")).toBe(1);
  });

  it("honours the configured wedge terminator", () => {
    expect(isTerminatorKey("Enter", "enter")).toBe(true);
    expect(isTerminatorKey("Tab", "enter")).toBe(false);
    expect(isTerminatorKey("Tab", "tab")).toBe(true);
    expect(isTerminatorKey("Enter", "enter_or_tab")).toBe(true);
  });
});

describe("scan.ratelimit", () => {
  it("allows 120 look-ups per minute per key and refuses the 121st", () => {
    let t = 0;
    const rl = createRateLimiter(120, 60_000, () => t);
    for (let i = 0; i < 120; i++) expect(rl.hit("u1")).toBe(true);
    expect(rl.hit("u1")).toBe(false);
    expect(rl.hit("u2")).toBe(true);
    t = 60_001;
    expect(rl.hit("u1")).toBe(true);
  });
});
