/**
 * Round 5 search (ADR-129): short numbers, plain questions, things to do, and what Enter opens
 * (A report bug B14, B report task 6, C report #15). Pure parts; the database part is in
 * tests/integration/scan/search-round5.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { endsWithNumberRegex, parseShortNumber } from "@/modules/scan/number-query";
import { SEARCH_ACTIONS, questionTargets, searchActions, searchScreens } from "@/app/(app)/search-screens";
import { enterChoice, type EnterRow } from "@/ui/search-enter";

const everyone = (_p: Permission) => true;
const bundle = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};

describe("short numbers", () => {
  it.each([
    ["4", null, "4"],
    ["0003", null, "3"],
    ["00012", null, "12"],
    ["SO 4", ["SO"], "4"],
    ["so-4", ["SO"], "4"],
    ["inv4", ["INV"], "4"],
    ["B 3", ["B"], "3"],
    ["order 4", ["SO", "PO", "WO"], "4"],
    ["orders 4", ["SO", "PO", "WO"], "4"],
    ["batch 0003", ["B"], "3"],
    ["customer order 12", ["SO"], "12"],
    ["order #4", ["SO", "PO", "WO"], "4"],
  ])("%s → %j ending with %s", (typed, prefixes, n) => {
    expect(parseShortNumber(typed)).toEqual({ prefixes, n });
  });

  it("words, long numbers and unknown words are not short numbers", () => {
    for (const t of ["coconut", "26-00001", "BILL-26-00001", "1234567", "pasig 4", "", "SO-26-00004"]) expect(parseShortNumber(t), t).toBeNull();
  });

  it("the regex finds numbers that END with the number, any zeros before it", () => {
    const re = (n: string) => new RegExp(endsWithNumberRegex(n));
    expect(re("4").test("SO-26-00004")).toBe(true);
    expect(re("4").test("CUS-0004")).toBe(true);
    expect(re("4").test("SO-26-00014")).toBe(false);
    expect(re("4").test("SO-26-00040")).toBe(false);
    expect(re("3").test("B-26-0003")).toBe(true);
    expect(re("3").test("L-2611-00013")).toBe(false);
    expect(re("12").test("PO-26-00012")).toBe(true);
  });
});

describe("plain questions and things to do", () => {
  it("who owes us → customer statements and Money", () => {
    expect(questionTargets("who owes us money?")).toEqual(["/finance/statements", "/finance"]);
    expect(searchScreens("who owes", everyone, ["owner_director"]).map((s) => s.href).slice(0, 2)).toEqual(["/finance/statements", "/finance"]);
  });

  it("this month's sales → the sales screens", () => {
    expect(searchScreens("this month's sales", everyone, ["owner_director"]).map((s) => s.href)).toContain("/analytics/overview");
    expect(searchScreens("sales this month", everyone, ["owner_director"])[0].href).toBe("/analytics/overview");
  });

  it("new customer → the New customer form, and Enter may open it", () => {
    const hits = searchActions("new customer", everyone);
    expect(hits[0]).toMatchObject({ label: "New customer", href: "/sales/customers/new", action: true, exact: true });
    expect(searchActions("make order", everyone)[0].href).toBe("/sales/new");
    expect(searchActions("record a payment", everyone)[0].href).toBe("/finance/payments/new");
  });

  it("an action needs its permission (a warehouse person cannot start a new customer)", () => {
    expect(searchActions("new customer", bundle("warehouse_operator"))).toEqual([]);
    for (const role of Object.keys(ROLE_BUNDLES))
      for (const a of SEARCH_ACTIONS)
        for (const w of a.words)
          for (const hit of searchActions(w, bundle(role))) {
            const action = SEARCH_ACTIONS.find((x) => x.href === hit.href)!;
            const perms = typeof action.permission === "string" ? [action.permission] : action.permission;
            expect(perms.some((p) => bundle(role)(p)), `${role} "${w}" → ${hit.href}`).toBe(true);
          }
  });
});

describe("what Enter opens (A report B14)", () => {
  type R = EnterRow & { name: string };
  const qaTest: R = { name: "Quality test INS-26-00003", href: "/quality/inspections/i3", kind: "record" };
  const batch: R = { name: "Batch B-26-0003", href: "/production/b3", kind: "record" };
  const screen: R = { name: "Batch records", href: "/production", kind: "screen" };

  it("the record whose number was typed comes first", () => {
    expect(enterChoice([qaTest, { ...batch, exact: true }], { exactHref: "/production/b3", active: 0, moved: false })?.href).toBe("/production/b3");
    expect(enterChoice([qaTest, { ...batch, exact: true }], { exactHref: null, active: 0, moved: false })?.href).toBe("/production/b3");
  });

  it("several matches and no highlight: nothing opens (never the first hit of another type)", () => {
    expect(enterChoice([qaTest, batch, screen], { exactHref: null, active: 0, moved: false })).toBeNull();
  });

  it("a row the person highlighted opens", () => {
    expect(enterChoice([qaTest, batch, screen], { exactHref: null, active: 1, moved: true })).toBe(batch);
  });

  it("the only row opens; one exact action opens", () => {
    expect(enterChoice([batch], { exactHref: null, active: 0, moved: false })).toBe(batch);
    const act: R = { name: "New customer", href: "/sales/customers/new", kind: "action", exact: true };
    expect(enterChoice([act, screen], { exactHref: null, active: 0, moved: false })).toBe(act);
  });

  it("an exact number beats a highlighted row", () => {
    expect(enterChoice([qaTest, { ...batch, exact: true }], { exactHref: "/production/b3", active: 0, moved: true })?.href).toBe("/production/b3");
  });
});
