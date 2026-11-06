/**
 * UX re-audit B (2026-11-01): plain plurals, names before codes, role-aware "waiting for", the supplier's lot
 * rule, the 50 × 30 test label and the old-layout note. Pure helpers only; the read models are covered by
 * the integration tests named in the decision log.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plural, pluralWord } from "@/lib/plural";
import { placeWords } from "@/ui/inventory/place-name";
import { isOldLayout, OLD_LAYOUT_NOTE } from "@/ui/labels/words";
import { PURCHASING_TEAM, teamFirst, WAREHOUSE_TEAM, whoWords } from "@/app/(app)/sales/who-words";
import { supplierLotRequired } from "@/modules/inventory/receiving-state";
import { labelGeometry, testPageRows } from "@/modules/documents/renderers/label-v2";
import { deliveryContents } from "@/app/(app)/sales/delivery-words";

const APP = join(process.cwd(), "src", "app", "(app)");

describe("plural", () => {
  it("never writes (s)", () => {
    expect(plural(1, "box", "boxes")).toBe("1 box");
    expect(plural(3, "box", "boxes")).toBe("3 boxes");
    expect(plural(0, "purchase order")).toBe("0 purchase orders");
    expect(plural(1200, "label")).toBe("1,200 labels");
    expect(plural("1", "lot")).toBe("1 lot");
    expect(pluralWord(2, "waits", "wait")).toBe("wait");
  });
});

describe("names before codes", () => {
  it("puts the place name first, the code only when it adds something", () => {
    expect(placeWords("Finished goods bay", "FG-01")).toBe("Finished goods bay (FG-01)");
    expect(placeWords("Oils rack A-01", "A-01")).toBe("Oils rack A-01");
    expect(placeWords(null, "SHP")).toBe("SHP");
    expect(placeWords("", "")).toBe("—");
  });

  it("the two QA cages have different names in the demo seed (N1)", () => {
    const seed = readFileSync(join(process.cwd(), "src", "db", "seed.ts"), "utf8");
    const names = [...seed.matchAll(/\[nfd\.id, whN\.id, "([A-Z0-9-]+)", "([^"]+)"/g)].map((m) => m[2]);
    expect(new Set(names).size).toBe(names.length);
    expect(seed).not.toContain('"QA hold cage"');
  });

  it("send-out pages show shelf names, not bare codes (N3)", () => {
    for (const f of [["sales", "picking", "[pickId]", "page.tsx"], ["sales", "packing", "[shipmentId]", "page.tsx"], ["sales", "shipments", "[shipmentId]", "page.tsx"], ["sales", "[orderId]", "page.tsx"]]) {
      const src = readFileSync(join(APP, ...f), "utf8");
      expect(src, f.join("/")).toContain("PlaceName");
      expect(src, f.join("/")).not.toMatch(/[Ss]helf \{[a-z]+\.locationCode\}|from shelf \{/);
    }
  });
});

describe("who we wait for (N5, N11)", () => {
  const owner = { name: "Ana Villanueva", role: "Owner/Director" };
  const mgr = { name: "Dino Reyes", role: "Site Manager" };
  const op = { name: "Nora Cruz", role: "Production Operator" };
  const wh = { name: "Lito Pascual", role: "Warehouse Operator" };
  const wh2 = { name: "Rey Lim", role: "Warehouse Operator" };
  it("names the warehouse people first for a warehouse step", () => {
    expect(whoWords([owner, mgr, wh], [], "a checker", WAREHOUSE_TEAM)).toBe("Lito Pascual (Warehouse Operator), Ana Villanueva (Owner/Director) or Dino Reyes (Site Manager)");
    expect(whoWords([owner, mgr, wh, wh2], [], "a checker", WAREHOUSE_TEAM)).toBe("Lito Pascual (Warehouse Operator), Rey Lim (Warehouse Operator) or someone else who may do it");
    expect(whoWords([wh, owner, mgr, wh2], [], "a checker", WAREHOUSE_TEAM)).toMatch(/^Lito Pascual \(Warehouse Operator\), Rey Lim/);
    expect(whoWords([owner, wh, mgr, wh2], [], "x", WAREHOUSE_TEAM)).not.toMatch(/production operator/i);
    expect(whoWords([owner, mgr, op, wh2, wh], [], "x", WAREHOUSE_TEAM)).toBe("Rey Lim (Warehouse Operator), Lito Pascual (Warehouse Operator) or someone else who may do it");
  });
  it("never calls a warehouse check 'another production operator'", () => {
    const line = whoWords([owner, mgr, op, { name: "Joy Tan", role: "Production Operator" }], [], "a checker", WAREHOUSE_TEAM);
    expect(line).not.toMatch(/another production operator/i);
    expect(line).toBe("Ana Villanueva (Owner/Director), Dino Reyes (Site Manager) or someone else who may do it");
  });
  it("falls back to roles, then the given words", () => {
    expect(whoWords([], ["Site Manager"], "a checker")).toBe("the Site Manager");
    expect(whoWords([], [], "a checker")).toBe("a checker");
  });
  it("puts purchasing first on the supplier-return refusal", () => {
    const tess = { name: "Tess Navarro", role: "Procurement" };
    const nina = { name: "Nina Santos", role: "QA/QC" };
    expect(teamFirst([wh, nina, tess], PURCHASING_TEAM)[0]).toEqual(tess);
  });
});

describe("supplier's lot number (A-SCAN-14)", () => {
  it("is required for ingredients and intermediates, optional for packaging and supplies", () => {
    expect(supplierLotRequired("raw_material")).toBe(true);
    expect(supplierLotRequired("intermediate")).toBe(true);
    expect(supplierLotRequired(null)).toBe(true);
    expect(supplierLotRequired("packaging")).toBe(false);
    expect(supplierLotRequired("consumable")).toBe(false);
  });
});

describe("labels (#12)", () => {
  it("the 50 × 30 test page keeps every row above the ruler; real labels keep their rows", () => {
    const small = labelGeometry(50, 30);
    expect(testPageRows(small)).toBeLessThan(small.rows);
    expect(testPageRows(small)).toBeLessThanOrEqual(1);
    const big = labelGeometry(100, 50);
    expect(testPageRows(big)).toBe(big.rows);
  });
  it("says when the old layout is used", () => {
    expect(isOldLayout(1)).toBe(true);
    expect(isOldLayout(2)).toBe(false);
    expect(isOldLayout(null)).toBe(false);
    expect(OLD_LAYOUT_NOTE).toMatch(/People, rules and settings › Labels and printouts/);
  });
});

describe("words", () => {
  it("delivery contents never say 'pcs pcs' or 'box(es)'", () => {
    expect(deliveryContents(1, "12")).toBe("1 box · 12 pcs");
    const packs = readFileSync(join(APP, "warehouse", "packs", "page.tsx"), "utf8");
    expect(packs).not.toMatch(/: ""\} pcs ·/);
  });
  it("boxing prints labels in place, never 'sent to the print station'", () => {
    const actions = readFileSync(join(APP, "sales", "fulfilment-actions.ts"), "utf8");
    expect(actions).not.toMatch(/print station/i);
    expect(actions).toContain("/print/labels/pack/");
    const pack = readFileSync(join(APP, "warehouse", "packs", "[packId]", "page.tsx"), "utf8");
    expect(pack).not.toContain("/labels?show=not_printed");
    expect(pack).not.toMatch(/BC:BOX, SKU/);
  });
  it("no '(s)' plurals, 'dispatch bay' or 'typed by hand' price words in the re-audited screens", () => {
    const files = [
      join(APP, "procurement", "page.tsx"),
      join(APP, "procurement", "suppliers", "page.tsx"),
      join(APP, "procurement", "forecast", "page.tsx"),
      join(APP, "procurement", "actions.ts"),
      join(APP, "sales", "fulfilment-actions.ts"),
      join(APP, "sales", "picking", "[pickId]", "page.tsx"),
      join(process.cwd(), "src", "lib", "location-sections.ts"),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/[a-z]\((s|es)\)[ .`]/);
      expect(src, f).not.toMatch(/dispatch bay/);
    }
    expect(readFileSync(join(APP, "sales", "[orderId]", "page.tsx"), "utf8")).toContain("price changed by hand");
    expect(readFileSync(join(APP, "sales", "picking", "[pickId]", "page.tsx"), "utf8")).not.toContain("Open the shipment");
  });
});
