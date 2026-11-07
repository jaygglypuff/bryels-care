import { describe, expect, it } from "vitest";
import { classifyPickInput, cleanTyped, codeKey, matchCandidate, matchTypedCode, parseVia, type PickCandidate } from "@/lib/scan/pick";
import { confirmLot } from "@/modules/production/dispensing";

/** Owner decision 2026-11-08 (A-SCAN-TYPED-01): every scan field also takes the number printed on the label. */
const boxes: PickCandidate[] = [
  { value: "BC:BOX:BX-00000005", title: "Box BX-00000005", code: "BX-00000005", codes: ["BX-00000005"] },
  { value: "BC:BOX:BX-00000012", title: "Box BX-00000012", code: "BX-00000012", codes: ["BX-00000012"] },
  { value: "BC:LOT:L-2611-00016", title: "Loose pieces", code: "L-2611-00016", codes: ["L-2611-00016"] },
];

describe("typed label codes", () => {
  it("codeKey ignores case, dashes, spaces and the BC: prefix", () => {
    expect(codeKey("bx-0000 0005")).toBe("BX00000005");
    expect(codeKey("BC:BOX:BX-00000005")).toBe("BX00000005");
    expect(codeKey("l2611-00016")).toBe("L261100016");
    expect(codeKey("")).toBe("");
  });

  it("cleanTyped upper-cases and drops spaces and control characters", () => {
    expect(cleanTyped("  bx 00000005\n")).toBe("BX00000005");
  });

  it("matches the whole code with or without dashes, any case", () => {
    expect(matchTypedCode(boxes, "bx00000005")).toMatchObject({ kind: "one", candidate: { code: "BX-00000005" } });
    expect(matchTypedCode(boxes, "BC:BOX:BX-00000012")).toMatchObject({ kind: "one", candidate: { code: "BX-00000012" } });
    expect(matchTypedCode(boxes, "l-2611-00016")).toMatchObject({ kind: "one", candidate: { code: "L-2611-00016" } });
    expect(matchCandidate(boxes, "bx00000005")?.code).toBe("BX-00000005");
  });

  it("matches the last characters when only one expected code ends with them", () => {
    expect(matchTypedCode(boxes, "0005")).toMatchObject({ kind: "one", candidate: { code: "BX-00000005" } });
    expect(matchTypedCode(boxes, "016")).toMatchObject({ kind: "one", candidate: { code: "L-2611-00016" } });
  });

  it("asks for more when two codes end the same way, and never matches under 3 characters", () => {
    expect(matchTypedCode(boxes, "000")).toMatchObject({ kind: "none" });
    const two = [...boxes, { value: "BC:BOX:BX-00001005", title: "x", code: "BX-00001005", codes: ["BX-00001005"] }];
    expect(matchTypedCode(two, "1005").kind).toBe("one");
    expect(matchTypedCode(two, "005").kind).toBe("many");
    expect(matchTypedCode(boxes, "05").kind).toBe("none");
  });

  it("does not match a number that is not expected (refused on the screen or by the server)", () => {
    expect(matchTypedCode(boxes, "BX-00000099").kind).toBe("none");
    expect(classifyPickInput("container", "BX-00000099", boxes, false, ["lot"]).kind).toBe("label");
  });

  it("refuses a label of another kind even when typed", () => {
    expect(classifyPickInput("container", "BC:LOC:A-01", boxes, false, ["lot"]).kind).toBe("refused");
  });

  it("parseVia accepts only scan, typed and tap", () => {
    expect(parseVia("typed")).toBe("typed");
    expect(parseVia("scan")).toBe("scan");
    expect(parseVia("tap")).toBe("tap");
    expect(parseVia("manual")).toBeNull();
    expect(parseVia(null)).toBeNull();
  });
});

describe("weigh lot confirmation typed (confirmLot)", () => {
  const lot = { lotNumber: "L-2611-00016" };
  it("a typed full lot number or its last 4 confirms, recorded as typed", () => {
    expect(confirmLot("scan", true, lot, "l261100016", "typed")).toBe("typed");
    expect(confirmLot("scan", true, lot, "BC:LOT:L-2611-00016", "typed")).toBe("typed");
    expect(confirmLot("last4", true, lot, "0016", "typed")).toBe("typed");
  });
  it("a scan stays a scan; the old last-4 path is unchanged", () => {
    expect(confirmLot("scan", true, lot, "BC:LOT:L-2611-00016", "scan")).toBe("scan");
    expect(confirmLot("last4", true, lot, "0016")).toBe("last4");
  });
  it("a wrong typed number and a tap are refused", () => {
    expect(() => confirmLot("scan", true, lot, "0017", "typed")).toThrow(/not lot L-2611-00016/);
    expect(() => confirmLot("scan", true, lot, "BC:LOT:L-2611-00016", "tap")).toThrow(/does not confirm/);
  });
});
