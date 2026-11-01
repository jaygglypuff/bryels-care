/**
 * ADR-104 §5 and ADR-106 §1–3 words (pure): the pick list per lot, the partial-container wording, the weigh card's
 * proposal, the off-plan warning, "day 2", "Continue … · started yesterday" and "Packed over 3 days".
 */
import { describe, expect, it } from "vitest";
import { amountWords, offPlanWarning, pickPlan, weighProposal } from "@/modules/production/pick-plan";
import { continueTitle, dayNumber, packedOverDays, startedWords } from "@/modules/production/batch-days-words";

const lot = (lotNumber: string, setAside: string, onHand: string, expiresOn: string | null = "2027-11-07", place = "A-01") => ({ lotId: lotNumber, lotNumber, place, expiresOn, setAside, onHand });

describe("Get materials pick plan (ADR-106 §1)", () => {
  it("splits across lots in use-first order: all of the first, the rest from the next", () => {
    const p = pickPlan("100000", "g", [lot("LM-2611-0005", "50000", "50000"), lot("LM-2611-0013", "50000", "50000", "2027-11-19")]);
    expect(p.steps.map((s) => [s.lotNumber, s.take, s.all])).toEqual([
      ["LM-2611-0005", "50000", true],
      ["LM-2611-0013", "50000", true],
    ]);
    expect(p.sentence).toBe("Take all 50 kg of lot LM-2611-0005 (A-01, expires 7 Nov 2027) + take all 50 kg of lot LM-2611-0013 (A-01, expires 19 Nov 2027).");
    expect(p.short).toBe("0");
  });

  it("partial container: bring it, weigh out what is needed, say what stays (ADR-106 §2)", () => {
    const p = pickPlan("50000", "g", [lot("LM-2611-0020", "50000", "180000", null, "Drum rack")]);
    expect(p.steps[0]).toMatchObject({ take: "50000", staysBehind: "130000", all: false });
    expect(p.sentence).toBe("Bring lot LM-2611-0020 (180 kg in it, Drum rack). Weigh out 50 kg. 130 kg stays for the next batch.");
  });

  it("stops when the need is covered and says what is not set aside", () => {
    expect(pickPlan("1500", "g", [lot("A", "1000", "1000"), lot("B", "5000", "5000")]).steps.map((s) => s.take)).toEqual(["1000", "500"]);
    const short = pickPlan("3000", "g", [lot("A", "1000", "1000", null)]);
    expect(short.short).toBe("2000");
    expect(short.sentence).toBe("Take all 1 kg of lot A (A-01). 2 kg is not set aside yet.");
    expect(pickPlan("300", "g", []).sentence).toBe("Nothing is set aside yet for 300 g.");
  });

  it("amount words keep exact decimals (no floating point drift)", () => {
    expect(amountWords("2620.4", "g")).toBe("2.62 kg");
    expect(amountWords("999.5", "g")).toBe("999.5 g");
    expect(amountWords("124", "pcs")).toBe("124 pcs");
  });
});

describe("weigh card follows Get materials (ADR-106 §3)", () => {
  it("proposes the same lots in the same order with amounts", () => {
    const p = pickPlan("100000", "g", [lot("LM-2611-0005", "50000", "50000"), lot("LM-2611-0013", "60000", "60000")]);
    expect(weighProposal(p, "g")).toBe("from LM-2611-0005: 50 kg, then LM-2611-0013: 50 kg");
    expect(weighProposal(pickPlan("1", "g", []), "g")).toBeNull();
  });
  it("another lot: the warning the owner asked for", () => {
    expect(offPlanWarning(["LM-2611-0005"])).toBe("This is not the lot you took at Get materials (LM-2611-0005). You can continue — QA will see a note.");
  });
});

describe("batches over several days (ADR-104 §5)", () => {
  const started = new Date("2026-11-03T01:00:00Z"); // Tue 3 Nov, 09:00 in Manila
  it("day number counts plant days in Manila", () => {
    expect(dayNumber(started, new Date("2026-11-03T10:00:00Z"))).toBe(1);
    expect(dayNumber(started, new Date("2026-11-03T17:00:00Z"))).toBe(2); // 01:00 on 4 Nov in Manila
    expect(dayNumber(started, new Date("2026-11-05T02:00:00Z"))).toBe(3);
  });
  it("Continue … · step 4 · started yesterday (only from the second day)", () => {
    expect(continueTitle("Calamansi Soap", "B-26-0006", 4, started, new Date("2026-11-04T02:00:00Z"))).toBe("Continue Calamansi Soap B-26-0006 · step 4 · started yesterday");
    expect(continueTitle("Calamansi Soap", "B-26-0006", 4, started, new Date("2026-11-06T02:00:00Z"))).toBe("Continue Calamansi Soap B-26-0006 · step 4 · started on Tue 3 Nov");
    expect(continueTitle("Calamansi Soap", "B-26-0006", 4, started, new Date("2026-11-03T05:00:00Z"))).toBeNull();
    expect(startedWords(started, new Date("2026-11-03T05:00:00Z"))).toBe("today");
  });
  it("Packed over 3 days: 400 + 350 + 250 = 1,000", () => {
    expect(packedOverDays([{ date: "2026-11-03", good: "400" }, { date: "2026-11-04", good: "350" }, { date: "2026-11-05", good: "250" }])).toBe("Packed over 3 days: 400 + 350 + 250 = 1,000");
    expect(packedOverDays([{ date: "2026-11-03", good: "400" }])).toBe("Packed on 1 day: 400");
    expect(packedOverDays([])).toBeNull();
  });
});
