/**
 * ADR-080 §11 (UX review §5): navigation and the iPad portrait tab bar follow the role. Operators get
 * "My work" and "Today"; owner/planner Orders, Today, Rejects, New order (+ Setup for the owner); the
 * old screens sit in a collapsed Advanced section; Maintenance is its own group; the tab bar never
 * shows "Batches" and never a bare "Orders" (it used to send production users to /sales).
 */
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { buildNav, productionPersona, tabsFor } from "@/app/(app)/nav";

const canFor = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};
const navOf = (role: string) => buildNav(canFor(role), [role]);
const production = (role: string) => navOf(role).find((g) => g.label === "Production");
const main = (role: string) => production(role)!.items.filter((i) => !i.section).map((i) => i.label);
const section = (role: string, s: "setup" | "advanced") => production(role)!.items.filter((i) => i.section === s).map((i) => i.label);
const tabs = (role: string) => tabsFor(canFor(role), [role]);

describe("production menu per role", () => {
  it("operators: My work and Today only; old screens under Advanced", () => {
    expect(productionPersona(canFor("production_operator"), ["production_operator"])).toBe("operator");
    expect(main("production_operator")).toEqual(["My work", "Today"]);
    expect(section("production_operator", "advanced")).toContain("Batches (full record)");
    expect(section("production_operator", "setup")).toEqual([]);
  });

  it("planner and site manager: Orders, Today, Rejects, New order; no Setup heading", () => {
    for (const r of ["production_planner", "site_manager"]) {
      expect(main(r)).toEqual(["Orders", "Today", "Rejects", "New order"]);
      expect(section(r, "setup")).toEqual([]);
      expect(section(r, "advanced")).toEqual(expect.arrayContaining(["Production plan", "Work orders (detailed)", "Board (detailed)"]));
    }
  });

  it("owner: the planner menu plus a Setup heading (products and formulas, steps, instructions, equipment)", () => {
    expect(main("owner_director")).toEqual(["Orders", "Today", "Rejects", "New order"]);
    expect(section("owner_director", "setup")).toEqual(["Products and formulas", "Steps for each product", "Work instructions", "Equipment"]);
  });

  it("no 'Defects', 'Stage materials' or bare 'Batches' entry; Maintenance is not in Production", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const p = production(r);
      if (!p) continue;
      const labels = p.items.map((i) => i.label);
      expect(labels).not.toContain("Defects");
      expect(labels).not.toContain("Stage materials");
      expect(labels).not.toContain("Batches");
      expect(p.items.some((i) => i.href.startsWith("/maintenance"))).toBe(false);
    }
    expect(navOf("owner_director").find((g) => g.label === "Maintenance")?.items.map((i) => i.href)).toContain("/maintenance");
  });

  it("menu items are filtered by permission (no entry the role cannot open)", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const can = canFor(r);
      for (const g of navOf(r)) for (const i of g.items) if (i.permission) expect(can(i.permission), `${r} ${i.href}`).toBe(true);
    }
    expect(main("sales_cs")).toEqual(["Orders"]); // view only: no New order, no Today
  });
});

describe("bottom tab bar (phone and iPad portrait) per role", () => {
  it("operator: Home · Today · Scan · Help", () => {
    expect(tabs("production_operator").map((t) => t.label)).toEqual(["Home", "Today", "Scan", "Help"]);
  });

  it("owner and manager: Home · Production · Sales · To approve · Menu; Production opens production orders", () => {
    for (const r of ["owner_director", "site_manager", "production_planner"]) {
      const t = tabs(r);
      expect(t.map((x) => x.label)).toEqual(["Home", "Production", "Sales", "To approve", "Menu"]);
      expect(t.find((x) => x.label === "Production")!.href).toBe("/production/orders");
      expect(t.find((x) => x.label === "Menu")!.href).toBeNull();
    }
  });

  it("QA: Home · Quality check · Production · Scan · Menu", () => {
    expect(tabs("qa_qc").map((t) => t.label)).toEqual(["Home", "Quality check", "Production", "Scan", "Menu"]);
  });

  it("never 'Batches', never a bare 'Orders', never the old batch list, and Sales only to people who see sales", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const t = tabs(r);
      expect(t.map((x) => x.label)).not.toContain("Batches");
      expect(t.map((x) => x.label)).not.toContain("Orders");
      expect(t.map((x) => x.href)).not.toContain("/production");
      const can = canFor(r);
      for (const x of t) if (x.permission) expect(can(x.permission), `${r} ${x.label}`).toBe(true);
      expect(t.length).toBeLessThanOrEqual(5);
    }
    expect(tabs("production_operator").map((x) => x.href)).not.toContain("/sales");
  });
});
