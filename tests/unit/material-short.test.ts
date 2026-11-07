/**
 * Owner 2026-11-07 (screenshot, Test Soap WO-26-00005): the order's Materials tab said "Missing 270.0 g" for Acapulco
 * Leaf Extract although all 270 g was used, and "Missing 10 pcs" for wrappers already ticked as taken on Get materials.
 * Short = what is needed minus what is set aside and minus what is already in the batch (taken on Get materials,
 * weighed in, or moved by the older staging) — never counted twice.
 */
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { materialShort } from "@/modules/production/material-short";

const d = (x: string | number) => new Decimal(x);
const short = (a: Partial<Record<"required" | "reserved" | "staged" | "consumed" | "ticked", number>>) =>
  materialShort({ required: d(a.required ?? 0), reserved: d(a.reserved ?? 0), staged: d(a.staged ?? 0), consumed: d(a.consumed ?? 0), ticked: d(a.ticked ?? 0) }).toString();

describe("materialShort", () => {
  it("nothing set aside or used: everything is missing", () => expect(short({ required: 270 })).toBe("270"));
  it("all of it set aside: nothing missing", () => expect(short({ required: 270, reserved: 270 })).toBe("0"));
  it("all of it weighed in (set aside released): nothing missing — the screenshot case", () => expect(short({ required: 270, consumed: 270 })).toBe("0"));
  it("ticked as taken on Get materials (no amount recorded): nothing missing", () => expect(short({ required: 10, ticked: 10 })).toBe("0"));
  it("taken by the older staging and then weighed: not counted twice", () => expect(short({ required: 1000, staged: 1000, consumed: 1000 })).toBe("0"));
  it("part weighed, the rest still set aside: nothing missing", () => expect(short({ required: 1000, reserved: 600, consumed: 400 })).toBe("0"));
  it("part weighed, nothing else set aside: the rest is missing", () => expect(short({ required: 1000, consumed: 400 })).toBe("600"));
  it("never negative", () => expect(short({ required: 10, reserved: 50 })).toBe("0"));
});
