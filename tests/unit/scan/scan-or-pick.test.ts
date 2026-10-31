import { describe, expect, it } from "vitest";
import { classifyPickInput, isScannerBurst, matchCandidate, missingMessage, notFoundMessage, submitValue, wrongKindMessage, type PickCandidate } from "@/lib/scan/pick";

/** Value resolution behind <ScanOrPick> (src/ui/scan-or-pick.tsx; owner review 2026-10-31). */
const lots: PickCandidate[] = [
  { value: "11111111-1111-4111-8111-111111111111", title: "Coconut oil", code: "L-2610-00001", codes: ["L-2610-00001", "SUP-77"] },
  { value: "22222222-2222-4222-8222-222222222222", title: "Shea butter", code: "L-2610-00002", codes: ["L-2610-00002"] },
  { value: "33333333-3333-4333-8333-333333333333", title: "Expired glycerin", code: "L-2610-00003", codes: ["L-2610-00003"], disabledReason: "Expired" },
];

describe("scan-or-pick value resolution", () => {
  it("a scanned label of an expected lot selects that candidate (no server call)", () => {
    expect(classifyPickInput("lot", "BC:LOT:L-2610-00002", lots)).toEqual({ kind: "candidate", candidate: lots[1] });
    expect(classifyPickInput("lot", "bc:lot:l-2610-00001\r\n", lots, true)).toEqual({ kind: "candidate", candidate: lots[0] });
  });

  it("a plain lot number or the supplier's lot code from the label also selects it", () => {
    expect(classifyPickInput("lot", "L-2610-00001", lots)).toMatchObject({ kind: "candidate", candidate: { title: "Coconut oil" } });
    expect(classifyPickInput("lot", "sup-77", lots)).toMatchObject({ kind: "candidate", candidate: { title: "Coconut oil" } });
  });

  it("the placeholder text is never a value", () => {
    for (const p of ["BC:LOT:…", "BC:LOT:...", "BC:LOC:…", "e.g. PKG-01", "BC:"]) {
      const r = classifyPickInput("lot", p, lots);
      expect(r.kind, p).toBe("refused");
    }
    expect(classifyPickInput("lot", "BC:LOT:…", lots)).toEqual({ kind: "refused", message: "We couldn't find that. Tap one of the lots above or scan the lot label again." });
  });

  it("empty input is empty, not a value", () => {
    expect(classifyPickInput("lot", "   ", lots)).toEqual({ kind: "empty" });
    expect(classifyPickInput("location", "\r\n")).toEqual({ kind: "empty" });
  });

  it("a label of another kind is refused in plain words", () => {
    expect(classifyPickInput("lot", "BC:LOC:PKG-01", lots)).toEqual({ kind: "refused", message: "That is a shelf label. Scan the lot label." });
    expect(classifyPickInput("location", "BC:LOT:L-2610-00001")).toEqual({ kind: "refused", message: wrongKindMessage("location", "LOT") });
    expect(classifyPickInput("container", "BC:LOT:L-1")).toMatchObject({ kind: "refused" });
    expect(classifyPickInput("item", "BC:SKU:SOAP-1")).toEqual({ kind: "label", payload: "BC:SKU:SOAP-1", value: "SOAP-1" });
    expect(classifyPickInput("batch", "BC:LOT:L-1")).toMatchObject({ kind: "refused" });
  });

  it("a label not in the list goes to the server, words go to the name search", () => {
    expect(classifyPickInput("lot", "BC:LOT:L-2610-00099", lots)).toEqual({ kind: "label", payload: "BC:LOT:L-2610-00099", value: "L-2610-00099" });
    expect(classifyPickInput("lot", "L-2610-00099", lots)).toEqual({ kind: "label", payload: "L-2610-00099", value: "L-2610-00099" });
    expect(classifyPickInput("lot", "coconut oil", lots)).toEqual({ kind: "words", text: "coconut oil" });
    expect(classifyPickInput("lot", "coconut", lots)).toEqual({ kind: "words", text: "coconut" });
    // From a scanner a single word is always a number, never a name.
    expect(classifyPickInput("location", "STORE", [], true)).toEqual({ kind: "label", payload: "STORE", value: "STORE" });
  });

  it("junk from a scanner and web links are refused", () => {
    expect(classifyPickInput("lot", "https://evil.example/x", lots, true).kind).toBe("refused");
    expect(classifyPickInput("lot", "BC:LOT:bad value!", lots, true).kind).toBe("refused");
  });

  it("a disabled candidate cannot be chosen by scanning it", () => {
    expect(matchCandidate(lots, "L-2610-00003")).toBeNull();
    expect(classifyPickInput("lot", "BC:LOT:L-2610-00003", lots)).toEqual({ kind: "label", payload: "BC:LOT:L-2610-00003", value: "L-2610-00003" });
  });

  it("a candidate id (tapped value) matches too", () => {
    expect(matchCandidate(lots, lots[1].value)).toBe(lots[1]);
  });

  it("submits the id by default and the number with submit=code", () => {
    expect(submitValue(lots[0], "value")).toBe(lots[0].value);
    expect(submitValue(lots[0], "code")).toBe("L-2610-00001");
    expect(submitValue({ value: "x", title: "X", codes: ["A-1"] }, "code")).toBe("A-1");
  });

  it("plain messages name the kind", () => {
    expect(notFoundMessage("container", true)).toBe("We couldn't find that. Tap one of the boxes above or scan the box label again.");
    expect(notFoundMessage("location", false)).toBe("We couldn't find that. Scan the shelf label again, or find it by name.");
    expect(missingMessage("lot", true)).toBe("Tap one of the lots above, or scan the lot label.");
  });

  it("recognises a hardware scanner burst (fast keys) and not a person typing", () => {
    expect(isScannerBurst({ chars: "BC:LOT:L-1", times: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45] })).toBe(true);
    expect(isScannerBurst({ chars: "BC:LOT:L-1", times: [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080] })).toBe(false);
    expect(isScannerBurst({ chars: "L1", times: [0, 5] })).toBe(false);
  });
});
