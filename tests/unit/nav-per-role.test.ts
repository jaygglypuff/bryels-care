/**
 * Round 5 navigation (ADR-129, docs/NEW_NAVIGATION.md; audits docs/ux-audit/round5/A-floor.md, B-owner-manager.md,
 * C-office.md). One catalogue of screens; per job a short menu of areas with at most five tabs and one flat "More";
 * floor roles get four bottom doors and no tab rows; Set-up sits behind the avatar menu. Menus never grant access.
 */
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { AREAS_BY_PERSONA, IT_SYSTEM, MAX_TABS, MORE, NAV, activeEntry, buildNav, canSee, groupSections, homeHref, isApprover, navPersona, setupSections, tabsFor } from "@/app/(app)/nav";
import { allScreens } from "@/app/(app)/search-screens";

const canFor = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};
const navOf = (role: string, approver = true) => buildNav(canFor(role), [role], { approver });
const areas = (role: string) => navOf(role).map((g) => g.label);
const group = (role: string, label: string) => navOf(role).find((g) => g.label === label);
const tabsOf = (role: string, label: string) => groupSections(group(role, label)!).main.map((i) => i.label);
const hrefsOf = (role: string) => navOf(role).flatMap((g) => g.items.map((i) => i.href.split("?")[0]));
const bottom = (role: string) => tabsFor(canFor(role), [role]).map((t) => t.label);
const ROLES = Object.keys(ROLE_BUNDLES);

describe("the catalogue (every screen once)", () => {
  it("areas in order: Home, Needs me, Sell, Make, Buy & stock, Money, Set-up", () => {
    expect(NAV.map((g) => g.label)).toEqual(["Home", "Needs me", "Sell", "Make", "Buy & stock", "Money", "Set-up"]);
  });

  it("every screen is listed once", () => {
    const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i)).toEqual([]);
  });

  it("every screen a persona's menu names exists in the catalogue", () => {
    const known = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)));
    for (const [persona, specs] of Object.entries(AREAS_BY_PERSONA))
      for (const a of specs) for (const h of [...a.tabs, ...(a.more ?? [])]) expect(known.has(h), `${persona} ${a.label} ${h}`).toBe(true);
  });

  it("every catalogue screen is found by search (pages that left a menu stay reachable)", () => {
    const found = new Set(allScreens().map((s) => s.href));
    for (const g of NAV) for (const i of g.items) expect(found.has(i.href), i.href).toBe(true);
  });
});

describe("owner and site manager (B report)", () => {
  it("six areas: Home · Needs me · Sell · Make · Buy & stock · Money; Set-up is not a menu area", () => {
    for (const r of ["owner_director", "site_manager"]) expect(areas(r), r).toEqual(["Home", "Needs me", "Sell", "Make", "Buy & stock", "Money"]);
  });

  it("Needs me merges To approve, Problems & alerts and Messages", () => {
    expect(tabsOf("owner_director", "Needs me")).toEqual(["To approve", "Problems & alerts", "Messages"]);
  });

  it("the production plan is a tab of Make; batch records are in Make's More", () => {
    expect(tabsOf("owner_director", "Make")).toContain("Production plan");
    expect(groupSections(group("owner_director", "Make")!).sections.find((s) => s.name === MORE)!.items.map((i) => i.label)).toContain("Batch records");
  });

  it("money is one area: invoices, bills, payments and reports together", () => {
    expect(tabsOf("owner_director", "Money")).toEqual(["Money", "Invoices", "Supplier bills", "Payments", "Reports"]);
  });

  it("the B report's rare screens are in no owner menu (search and Set-up reach them)", () => {
    const owner = hrefsOf("owner_director");
    for (const h of ["/floor", "/quality/bulk", "/quality/changes", "/quality/recall", "/warehouse/repack", "/quality/label-verification", "/inventory/containers", "/inventory/movements", "/labels", "/reports/schedules", "/analytics/definitions", "/analytics/trends", "/procurement/forecast", "/procurement/performance", "/procurement/returns", "/finance/periods", "/finance/tax"])
      expect(owner, h).not.toContain(h);
    for (const h of ["/masterdata/products", "/admin/settings", "/admin/users", "/masterdata/locations"]) expect(owner, h).not.toContain(h);
  });
});

describe("office roles (C report)", () => {
  it("sales: Home, Orders, Customers, Price offers, Invoices", () => {
    expect(areas("sales_cs")).toEqual(["Home", "Orders", "Customers", "Price offers", "Invoices"]);
  });

  it("purchasing: Home, Buying, Suppliers; purchasing appears once", () => {
    expect(areas("procurement")).toEqual(["Home", "Buying", "Suppliers"]);
    expect(tabsOf("procurement", "Buying")).toEqual(["What to buy", "Requests to buy", "Purchase orders", "Deliveries coming", "Deliveries received"]);
    expect(hrefsOf("procurement").filter((h) => h === "/procurement/orders").length).toBe(1);
  });

  it("finance: Home is the Money page; Money in, Money out, Month end, Reports", () => {
    expect(homeHref(["finance"])).toBe("/finance");
    expect(areas("finance")).toEqual(["Home", "Money in", "Money out", "Month end", "Reports"]);
    expect(group("finance", "Home")!.items[0].href).toBe("/finance");
  });

  it("QA: Home, Check, Problems, Trace; no sales and no money menus", () => {
    expect(areas("qa_qc")).toEqual(["Home", "Check", "Problems", "Trace"]);
    expect(hrefsOf("qa_qc").some((h) => h.startsWith("/sales") || h.startsWith("/finance"))).toBe(false);
  });
});

describe("floor roles (A report): four doors, no menu rows", () => {
  it("operator: My jobs · Scan · Batches · Help", () => {
    expect(bottom("production_operator")).toEqual(["My jobs", "Scan", "Batches", "Help"]);
  });

  it("warehouse: My jobs · Scan · Receive · Help", () => {
    expect(bottom("warehouse_operator")).toEqual(["My jobs", "Scan", "Receive", "Help"]);
  });

  it("site manager on a phone: My jobs · Scan · To check/approve · Help", () => {
    expect(bottom("site_manager")).toEqual(["My jobs", "Scan", "To check/approve", "Help"]);
    expect(tabsFor(canFor("site_manager"), ["site_manager"]).find((t) => t.label === "To check/approve")!.needsMe).toBe(true);
  });

  it("owner on a phone: Home · Needs me · Sell · Make · Money", () => {
    expect(bottom("owner_director")).toEqual(["Home", "Needs me", "Sell", "Make", "Money"]);
  });

  it("no bottom bar repeats a door, and none has more than five", () => {
    for (const r of ROLES) {
      const t = tabsFor(canFor(r), [r]);
      expect(t.length, r).toBeLessThanOrEqual(5);
      const hrefs = t.map((x) => x.href);
      expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i), r).toEqual([]);
      for (const x of t) if (x.permission) expect(canFor(r)(x.permission), `${r} ${x.label}`).toBe(true);
    }
  });

  it("floor personas are operator and warehouse", () => {
    expect(navPersona(canFor("production_operator"), ["production_operator"])).toBe("operator");
    expect(navPersona(canFor("warehouse_operator"), ["warehouse_operator"])).toBe("warehouse");
    expect(navPersona(canFor("site_manager"), ["site_manager"])).toBe("manager");
  });
});

describe("one door per job, short menus", () => {
  it("no area has more than five tabs, and the only list after them is one flat More", () => {
    for (const r of ROLES)
      for (const g of navOf(r)) {
        const { main, sections } = groupSections(g);
        expect(main.length, `${r} ${g.label}`).toBeLessThanOrEqual(MAX_TABS);
        expect(sections.map((s) => s.name).filter((n) => n !== MORE), `${r} ${g.label}`).toEqual([]);
      }
  });

  it("no role's menu lists the same screen twice, with or without approvals", () => {
    for (const r of ROLES)
      for (const approver of [true, false]) {
        const hrefs = navOf(r, approver).flatMap((g) => g.items.map((i) => i.href.split("?")[0]));
        expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i), r).toEqual([]);
      }
  });

  it("menu entries are filtered by permission (no entry the role cannot open)", () => {
    for (const r of ROLES) {
      const can = canFor(r);
      for (const g of navOf(r)) for (const i of g.items) expect(canSee(can, i.permission), `${r} ${i.href}`).toBe(true);
    }
  });

  it("IT and system screens are for the system admin and the owner only (Set-up page)", () => {
    for (const r of ["system_admin", "owner_director"]) expect(setupSections(canFor(r), [r]).map((s) => s.name), r).toContain(IT_SYSTEM);
    for (const r of ROLES.filter((x) => !["system_admin", "owner_director"].includes(x))) expect(setupSections(canFor(r), [r]).map((s) => s.name), r).not.toContain(IT_SYSTEM);
  });

  it("Set-up lists products, recipes, people, settings, labels, shelves, machines and numbering for the owner", () => {
    const hrefs = setupSections(canFor("owner_director"), ["owner_director"]).flatMap((s) => s.items.map((i) => i.href));
    for (const h of ["/masterdata/products", "/masterdata/recipes", "/masterdata/materials", "/admin/users", "/admin/settings", "/admin/templates", "/masterdata/locations", "/masterdata/equipment", "/admin/numbering"]) expect(hrefs, h).toContain(h);
  });

  it("To approve is only for approvers (ADR-082)", () => {
    const approver = (r: string, waiting: number) => isApprover(canFor(r), [r], ROLE_BUNDLES[r].permissions, waiting);
    expect(approver("owner_director", 0)).toBe(true);
    expect(approver("production_operator", 0)).toBe(false);
    expect(approver("production_operator", 2)).toBe(true);
    expect(approver("sales_cs", 0)).toBe(false);
    expect(navOf("owner_director", false).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/approvals");
  });
});

describe("the menu lights the page's own area (B report bug B13)", () => {
  it("a batch record lights Make for the owner, never Set-up", () => {
    const a = activeEntry(navOf("owner_director"), "/production/0190aaaa-0000-7000-8000-000000000001");
    expect(a.group?.label).toBe("Make");
    expect(a.href).toBe("/production");
  });

  it("a page outside the person's menu lights its catalogue area when they have it", () => {
    expect(activeEntry(navOf("owner_director"), "/quality/changes/x").group?.label).toBe("Make");
    expect(activeEntry(navOf("owner_director"), "/masterdata/products").group).toBeUndefined();
  });

  it("the search page is not under Buy & stock for the owner (it is the search)", () => {
    // /inventory/scan is in no owner menu; it still lights its catalogue area (Buy & stock) but no tab.
    expect(activeEntry(navOf("owner_director"), "/inventory/scan").href).toBe("");
  });
});

describe("Floor screen (ADR-084)", () => {
  it("the Floor display role lands on the floor screen", () => {
    expect(homeHref(["floor_display"])).toBe("/floor");
    expect(homeHref(["floor_display", "site_manager"])).toBe("/dashboard");
    expect(homeHref([])).toBe("/dashboard");
    expect(navOf("floor_display").flatMap((g) => g.items.map((i) => i.href))).toContain("/floor");
  });
});
