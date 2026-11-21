/** ADR-138 "Take a few out": pure rules (limits, undo, words, where to take from). */
import { describe, expect, it } from "vitest";
import { daysSince, limitReason, movementReason, orderSources, parsePieces, PURPOSE_WORDS, purposeSentence, TAKEOUT_TRANSITIONS, undoRefusal } from "@/modules/inventory/takeout-rules";
import { TAKEOUT_PURPOSES, TAKEOUT_STATUSES } from "@/db/schema/takeouts";

describe("limits", () => {
  it("posts at once up to the line and day limits", () => {
    expect(limitReason({ lines: ["2", "1"], takenTodayByPerson: "5", maxPerLine: 10, maxPerPersonDay: 30 })).toBeNull();
    expect(limitReason({ lines: ["10"], takenTodayByPerson: "20", maxPerLine: 10, maxPerPersonDay: 30 })).toBeNull();
  });
  it("one line above the limit waits for an OK, with the reason in words", () => {
    expect(limitReason({ lines: ["12", "1"], takenTodayByPerson: "0", maxPerLine: 10, maxPerPersonDay: 30 })).toBe("12 pieces of one product (up to 10 go out without an OK).");
  });
  it("the person's day total above the limit waits; both reasons are named", () => {
    expect(limitReason({ lines: ["3"], takenTodayByPerson: "28", maxPerLine: 10, maxPerPersonDay: 30 })).toBe("31 pieces by you today (up to 30 a day go out without an OK).");
    expect(limitReason({ lines: ["11"], takenTodayByPerson: "25", maxPerLine: 10, maxPerPersonDay: 30 })).toMatch(/^11 pieces of one product .* and 36 pieces by you today/);
  });
});

describe("undo", () => {
  const posted = new Date("2026-11-21T03:00:00Z"); // 11:00 Manila
  it("the person who took them out may undo the same Manila day", () => {
    expect(undoRefusal({ createdBy: "u1", postedAt: posted, userId: "u1", canVoid: false, now: new Date("2026-11-21T15:59:00Z") })).toBeNull();
  });
  it("not the next Manila day, and never someone else, without the void permission", () => {
    expect(undoRefusal({ createdBy: "u1", postedAt: posted, userId: "u1", canVoid: false, now: new Date("2026-11-21T16:01:00Z") })).toMatch(/same day/);
    expect(undoRefusal({ createdBy: "u1", postedAt: posted, userId: "u2", canVoid: false, now: posted })).toMatch(/Only the person/);
  });
  it("a holder of the void permission may undo any time", () => {
    expect(undoRefusal({ createdBy: "u1", postedAt: posted, userId: "u2", canVoid: true, now: new Date("2027-01-01T00:00:00Z") })).toBeNull();
  });
});

describe("words", () => {
  it("every purpose has words; the state machine covers every status and only a posted take-out can be undone", () => {
    for (const p of TAKEOUT_PURPOSES) expect(PURPOSE_WORDS[p].label).toBeTruthy();
    expect(Object.keys(TAKEOUT_TRANSITIONS).sort()).toEqual([...TAKEOUT_STATUSES].sort());
    expect(TAKEOUT_TRANSITIONS.posted).toEqual(["reversed"]);
    expect(TAKEOUT_TRANSITIONS.reversed).toEqual([]);
    expect(TAKEOUT_TRANSITIONS.awaiting_approval).toContain("posted");
  });
  it("sentences name the channel label from the configured list, the order number and the sample's customer", () => {
    const channels = [{ code: "shopee", label: "Shopee" }];
    expect(purposeSentence({ purpose: "sold_online", channel: "shopee", platformOrderRef: "2411ABC" }, channels)).toBe("Sold online · Shopee · order 2411ABC");
    expect(purposeSentence({ purpose: "sold_online", channel: "old_shop" }, channels)).toBe("Sold online · old shop");
    expect(purposeSentence({ purpose: "customer_sample", customerName: "Isla Spa Supplies" })).toBe("Sample for Isla Spa Supplies");
    expect(purposeSentence({ purpose: "customer_sample", recipientName: "Walk-in buyer" })).toBe("Sample for Walk-in buyer");
    expect(purposeSentence({ purpose: "other", note: "Broken in the van" })).toBe("Other: Broken in the van");
    expect(movementReason("TKO-26-000001", "Giveaway or marketing")).toBe("Take-out TKO-26-000001: Giveaway or marketing");
  });
  it("pieces are whole numbers above zero", () => {
    expect(parsePieces("2")?.toString()).toBe("2");
    expect(parsePieces(" 12 ")?.toString()).toBe("12");
    for (const bad of ["0", "1.5", "-1", "", "abc", "12345678"]) expect(parsePieces(bad)).toBeNull();
  });
});

describe("where to take from", () => {
  const c = (o: Partial<Parameters<typeof orderSources>[0][number]>) => ({ lotId: "l", locationId: "x", containerId: null, boxStatus: null, shopShelf: false, expiresOn: null, lotNumber: "L-1", free: "5", ...o });
  it("shop shelf first, then open boxes and loose pieces, then sealed boxes by earliest expiry; nothing free is dropped", () => {
    const out = orderSources([
      c({ lotNumber: "A", boxStatus: "sealed", expiresOn: "2027-01-01" }),
      c({ lotNumber: "B", boxStatus: "open", expiresOn: "2027-06-01" }),
      c({ lotNumber: "C", boxStatus: "sealed", expiresOn: "2026-12-01" }),
      c({ lotNumber: "D", boxStatus: "sealed", shopShelf: true, expiresOn: "2028-01-01" }),
      c({ lotNumber: "E", boxStatus: null, expiresOn: null }),
      c({ lotNumber: "F", boxStatus: "open", free: "0" }),
    ]);
    expect(out.map((x) => x.lotNumber)).toEqual(["D", "B", "E", "C", "A"]);
  });
  it("days since, in Manila days", () => {
    expect(daysSince(new Date("2026-11-18T01:00:00Z"), new Date("2026-11-21T01:00:00Z"))).toBe(3);
    expect(daysSince(null)).toBeNull();
  });
});
