/**
 * ADR-081 (five destinations) and ADR-080 §11 (per role): the menu is Home, Operations, Inventory,
 * Sales & Customers, Management, filtered by permission. Operators get "My work" and "Today"; the old
 * production screens sit in a collapsed Advanced section; Production setup lives in Management; the
 * tab bar has at most five tabs and never shows "Batches" or a bare "Orders".
 */
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { ADVANCED, NAV, buildNav, groupSections, productionPersona, tabsFor } from "@/app/(app)/nav";

const canFor = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};
const navOf = (role: string) => buildNav(canFor(role), [role]);
const group = (role: string, label: string) => navOf(role).find((g) => g.label === label);
const main = (role: string, label = "Operations") => groupSections(group(role, label)!).main.map((i) => i.label);
const section = (role: string, label: string, name: string) => groupSections(group(role, label)!).sections.find((s) => s.name === name)?.items.map((i) => i.label) ?? [];
const tabs = (role: string) => tabsFor(canFor(role), [role]);

describe("five destinations", () => {
  it("the full menu is exactly Home, Operations, Inventory, Sales & Customers, Management", () => {
    expect(NAV.map((g) => g.label)).toEqual(["Home", "Operations", "Inventory", "Sales & Customers", "Management"]);
    expect(navOf("owner_director").map((g) => g.label)).toEqual(["Home", "Operations", "Inventory", "Sales & Customers", "Management"]);
  });

  it("every screen is listed once (no duplicate paths in the menu)", () => {
    const hrefs = NAV.flatMap((g) => g.items.filter((i) => !i.planned).map((i) => i.href));
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it("operators do not see Management or Sales & Customers", () => {
    expect(navOf("production_operator").map((g) => g.label)).toEqual(["Home", "Operations", "Inventory"]);
    expect(navOf("warehouse_operator").map((g) => g.label)).not.toContain("Management");
  });

  it("menu items are filtered by permission (no entry the role cannot open)", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const can = canFor(r);
      for (const g of navOf(r)) for (const i of g.items) if (i.permission) expect(can(i.permission), `${r} ${i.href}`).toBe(true);
    }
  });

  it("Advanced is always the last section", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const ops = group(r, "Operations");
      if (!ops) continue;
      const names = groupSections(ops).sections.map((s) => s.name);
      if (names.includes(ADVANCED)) expect(names.at(-1)).toBe(ADVANCED);
    }
  });
});

describe("production tabs per role (ADR-080 §11)", () => {
  it("operators: Operations Center, My work and Today; old screens under Advanced", () => {
    expect(productionPersona(canFor("production_operator"), ["production_operator"])).toBe("operator");
    expect(main("production_operator")).toEqual(["Operations Center", "My work", "Today"]);
    expect(section("production_operator", "Operations", ADVANCED)).toContain("Batches (full record)");
  });

  it("planner, site manager and owner: Production orders, Today, Rejects, New order", () => {
    for (const r of ["production_planner", "site_manager", "owner_director"]) {
      expect(main(r)).toEqual(expect.arrayContaining(["Operations Center", "Production orders", "Today", "Rejects", "New order"]));
      expect(section(r, "Operations", ADVANCED)).toEqual(expect.arrayContaining(["Production plan", "Work orders (detailed)", "Board (detailed)"]));
    }
  });

  it("Production setup sits in Management, not in Operations", () => {
    expect(section("owner_director", "Management", "Production setup")).toEqual(["Products and formulas", "Steps for each product", "Work instructions", "Inspection plans", "Equipment"]);
    const opsHrefs = group("owner_director", "Operations")!.items.map((i) => i.href);
    expect(opsHrefs.some((h) => h.startsWith("/masterdata"))).toBe(false);
  });

  it("no 'Defects', 'Stage materials' or bare 'Batches' entry; maintenance is a section of Operations", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const labels = navOf(r).flatMap((g) => g.items.map((i) => i.label));
      expect(labels).not.toContain("Defects");
      expect(labels).not.toContain("Stage materials");
      expect(labels).not.toContain("Batches");
    }
    expect(section("owner_director", "Operations", "Maintenance")).toContain("Maintenance");
  });

  it("receiving steps sit together in Operations → Receiving; picking and dispatch in Packing & dispatch", () => {
    expect(section("owner_director", "Operations", "Receiving")).toEqual(["Expected deliveries", "Receive materials", "Goods receipts", "Put away"]);
    expect(section("owner_director", "Operations", "Packing & dispatch")).toEqual(expect.arrayContaining(["Boxing", "Picking", "Dispatch"]));
  });

  it("customer billing sits with Sales & Customers", () => {
    expect(section("owner_director", "Sales & Customers", "Billing & payments")).toEqual(["Invoices", "Payments", "Statements", "Credit notes"]);
  });
});

describe("bottom tab bar (phone and iPad portrait) per role", () => {
  it("operator: Home · My work · Today · Scan · Menu", () => {
    expect(tabs("production_operator").map((t) => t.label)).toEqual(["Home", "My work", "Today", "Scan", "Menu"]);
  });

  it("warehouse: Home · Receive · Scan · Inventory · Menu", () => {
    expect(productionPersona(canFor("warehouse_operator"), ["warehouse_operator"])).toBe("warehouse");
    expect(tabs("warehouse_operator").map((t) => t.label)).toEqual(["Home", "Receive", "Scan", "Inventory", "Menu"]);
  });

  it("owner and manager: Home · Operations · Inventory · Sales · Menu", () => {
    for (const r of ["owner_director", "site_manager", "production_planner"]) {
      const t = tabs(r);
      expect(t.map((x) => x.label)).toEqual(["Home", "Operations", "Inventory", "Sales", "Menu"]);
      expect(t.find((x) => x.label === "Operations")!.href).toBe("/operations");
      expect(t.find((x) => x.label === "Menu")!.href).toBeNull();
    }
  });

  it("QA: Home · Quality check · Operations · Scan · Menu", () => {
    expect(tabs("qa_qc").map((t) => t.label)).toEqual(["Home", "Quality check", "Operations", "Scan", "Menu"]);
  });

  it("never 'Batches', never a bare 'Orders', never the old batch list, at most five tabs, always a way to the menu", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const t = tabs(r);
      expect(t.map((x) => x.label)).not.toContain("Batches");
      expect(t.map((x) => x.label)).not.toContain("Orders");
      expect(t.map((x) => x.href)).not.toContain("/production");
      const can = canFor(r);
      for (const x of t) if (x.permission) expect(can(x.permission), `${r} ${x.label}`).toBe(true);
      expect(t.length).toBeLessThanOrEqual(5);
      expect(t.at(-1)!.label, r).toBe("Menu");
    }
    expect(tabs("production_operator").map((x) => x.href)).not.toContain("/sales");
  });
});
