import { describe, expect, it } from "vitest";
import { forbiddenAskLine } from "@/app/(app)/forbidden-words";
import { waitingLine } from "@/app/(app)/waiting-words";
import { deliveryContents } from "@/app/(app)/sales/delivery-words";
import { belowMinimum, startingOrderQty } from "@/lib/po-amount";
import { plainNote } from "@/lib/plain-note";

describe("whom to ask on a refused screen (UX audit B #8)", () => {
  it("names the people who can do it", () => {
    expect(forbiddenAskLine(["site_manager"], [{ name: "Tess Navarro", role: "Purchasing" }])).toBe("Ask Tess Navarro (Purchasing) to do it, or to give you access.");
  });
  it("never tells a site manager or owner to ask the site manager", () => {
    expect(forbiddenAskLine(["site_manager"], [])).toBe("Ask the owner if you need it.");
    expect(forbiddenAskLine(["owner_director"], [])).toBe("Ask your system administrator if you need it.");
    expect(forbiddenAskLine(["production_operator"], [])).toBe("Ask your site manager if you need it.");
  });
});

describe("Waiting for <name> (role)", () => {
  it("names up to three people, else the role with where access is given", () => {
    expect(waitingLine([{ name: "Tess Navarro", role: "Purchasing" }], "to send it for approval", "purchasing")).toBe("Waiting for Tess Navarro (Purchasing) to send it for approval.");
    expect(waitingLine([], "to send it", "purchasing")).toMatch(/^Waiting for purchasing to send it\. Nobody at this site can do it yet: .*Management › People & access › People who use the app\.$/);
  });
});

describe("delivery rows (UX audit B #10)", () => {
  it("no 'box(es)' and no '0 box(es) · 0 pcs'", () => {
    expect(deliveryContents(0, "48.000000")).toBe("48 pcs");
    expect(deliveryContents(1, "48")).toBe("1 box · 48 pcs");
    expect(deliveryContents(2, "96")).toBe("2 boxes · 96 pcs");
    expect(deliveryContents(0, "0")).toBe("Nothing on it yet");
  });
});

describe("purchase order amount (UX audit B #13)", () => {
  const coconut = { baseUom: "g", packQty: "18", packUom: "kg", moqQty: "50", moqUom: "kg" };
  it("starts at the supplier's minimum when it is more than one pack", () => {
    expect(startingOrderQty(coconut, "kg")).toBe("50");
    expect(startingOrderQty({ ...coconut, moqQty: null }, "kg")).toBe("18");
    expect(startingOrderQty({ ...coconut, packQty: null, packUom: null }, "kg")).toBe("50");
    expect(startingOrderQty({ ...coconut, moqQty: "10" }, "kg")).toBe("18");
    expect(startingOrderQty({ baseUom: "g", packQty: null, packUom: null, moqQty: null, moqUom: null }, "kg")).toBe("");
  });
  it("warns below the minimum on the last step", () => {
    expect(belowMinimum(coconut, "18", "kg")).toBe(true);
    expect(belowMinimum(coconut, "50", "kg")).toBe(false);
    expect(belowMinimum(coconut, "60000", "g")).toBe(false);
    expect(belowMinimum({ ...coconut, moqQty: null }, "1", "kg")).toBe(false);
  });
});

describe("report footnotes (UX audit C #6)", () => {
  it("drop design references and trade words", () => {
    expect(plainNote("Value of goods dispatched in the period at the order's unit price. An estimate of revenue until invoices exist (Phase 6, A-KPI-10).")).toBe("Value of goods dispatched in the period at the order's unit price. An estimate of revenue until invoices exist.");
    expect(plainNote("Needs invoices and final costing runs (finance scope, ADR-020).")).toBe("Needs invoices and final costing runs.");
    expect(plainNote("every BOM material requirement")).toBe("every recipe ingredient");
  });
});
