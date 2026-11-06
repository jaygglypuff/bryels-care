/**
 * ADR-081 (five destinations) and ADR-080 §11 (per role): the menu is Home, Operations, Inventory,
 * Sales & Customers, Management, filtered by permission. UX audit R2: one door per job, a smaller office menu,
 * menu words = screen titles (tests/unit/nav-titles.test.ts). Operators get "My work" and "Today"; the old
 * production screens sit in a collapsed Advanced section; Production setup lives in Management; the
 * tab bar has at most five tabs and never shows "Batches" or a bare "Orders".
 */
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { ADVANCED, IT_SYSTEM, NAV, PEOPLE_SETTINGS, buildNav, canSee, groupSections, homeHref, isApprover, productionPersona, tabsFor } from "@/app/(app)/nav";

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
    // The one deliberate exception (re-audit B #11): Deliveries also sits under Sales for office sales people only;
    // buildNav drops it from Operations for them, so no role sees it twice (checked below).
    const hrefs = NAV.flatMap((g) => g.items.filter((i) => !i.planned && !i.salesDesk).map((i) => i.href));
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it("office sales people find Deliveries under Sales & Customers only; others under Operations only", () => {
    const where = (role: string) => navOf(role).filter((g) => g.items.some((i) => i.href === "/sales/shipments")).map((g) => g.label);
    expect(where("sales_cs")).toEqual(["Sales & Customers"]);
    expect(where("owner_director")).toEqual(["Operations"]);
    expect(where("warehouse_operator")).toEqual(["Operations"]);
  });

  it("operators do not see Management or Sales & Customers", () => {
    expect(navOf("production_operator").map((g) => g.label)).toEqual(["Home", "Operations", "Inventory"]);
    expect(navOf("warehouse_operator").map((g) => g.label)).not.toContain("Management");
    expect(navOf("warehouse_operator").map((g) => g.label)).not.toContain("Sales & Customers");
  });

  it("menu items are filtered by permission (no entry the role cannot open)", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const can = canFor(r);
      for (const g of navOf(r)) for (const i of g.items) expect(canSee(can, i.permission), `${r} ${i.href}`).toBe(true);
    }
  });

  it("Planning tools and IT and system are always the last sections, in that order", () => {
    for (const r of Object.keys(ROLE_BUNDLES))
      for (const g of navOf(r)) {
        const names = groupSections(g).sections.map((s) => s.name);
        const tail = names.filter((n) => n === ADVANCED || n === IT_SYSTEM);
        expect(names.slice(names.length - tail.length), `${r} ${g.label}`).toEqual(tail);
        if (tail.length === 2) expect(tail).toEqual([ADVANCED, IT_SYSTEM]);
      }
  });
});

describe("one door per job (UX audit R2)", () => {
  it("no role's menu lists the same screen twice (query strings ignored)", () => {
    for (const r of Object.keys(ROLE_BUNDLES))
      for (const approver of [true, false]) {
        const hrefs = buildNav(canFor(r), [r], { approver }).flatMap((g) => g.items.filter((i) => !i.planned).map((i) => i.href.split("?")[0]));
        const dups = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
        expect(dups, r).toEqual([]);
      }
  });

  it("no two entries of a role's menu share a word", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const labels = navOf(r).flatMap((g) => g.items.map((i) => i.label));
      expect(labels.filter((l, i) => labels.indexOf(l) !== i), r).toEqual([]);
    }
  });

  it("To approve is a top-bar button from 640 px and a phone tab; Messages is the top-bar bell, not a tab", () => {
    const home = group("owner_director", "Home")!.items;
    expect(home.find((i) => i.href === "/approvals")?.topBar).toBe("wide");
    expect(home.find((i) => i.href === "/notifications")?.topBar).toBe("always");
    expect(home.find((i) => i.href === "/action-centre")?.label).toBe("Problems & alerts");
  });

  it("one QA door, one supplier list, one expense-claims entry", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const hrefs = navOf(r).flatMap((g) => g.items.map((i) => i.href));
      expect(hrefs, r).not.toContain("/quality/check"); // opens from "Check a batch or delivery"
      expect(hrefs, r).not.toContain("/masterdata/suppliers"); // "Suppliers we may buy from" links to it
      expect(hrefs.filter((h) => h.startsWith("/finance/expenses")).length, r).toBeLessThanOrEqual(1);
    }
    expect(main("owner_director")).toContain("Check a batch or delivery");
    expect(section("owner_director", "Management", "Purchasing")).toContain("Suppliers we may buy from");
    // The owner and site manager approve claims but do not file them; staff file them: one entry for both.
    for (const r of ["owner_director", "site_manager", "finance", "production_operator"]) expect(section(r, "Home", "Help & my account"), r).toContain("Expense claims");
    expect(section("owner_director", "Management", "Finance")).not.toContain("Expense approvals");
  });

  it("the three quality screens have three different names", () => {
    const all = navOf("owner_director").flatMap((g) => g.items.map((i) => i.label));
    for (const w of ["Check a batch or delivery", "Quality tests", "Quality checks for each item"]) expect(all).toContain(w);
    expect(all).not.toContain("Quality check");
    expect(all).not.toContain("Quality checks");
  });
});

describe("a smaller office menu (UX audit R2)", () => {
  const IT = ["/admin/sessions", "/admin/security", "/admin/devices", "/sync/conflicts", "/admin/diagnostics", "/admin/retention", "/admin/imports", "/admin/imports/legacy-documents"];

  it("IT and system: the rare IT screens, only for the system admin and the owner", () => {
    for (const r of ["system_admin", "owner_director"]) {
      const sec = groupSections(group(r, "Management")!).sections.find((s) => s.name === IT_SYSTEM);
      expect(sec, r).toBeDefined();
      for (const i of sec!.items) expect(IT, `${r} ${i.href}`).toContain(i.href);
    }
    expect(section("owner_director", "Management", IT_SYSTEM).length).toBe(IT.length);
    for (const r of Object.keys(ROLE_BUNDLES).filter((x) => !["system_admin", "owner_director"].includes(x))) {
      const hrefs = navOf(r).flatMap((g) => g.items.map((i) => i.href));
      for (const h of IT) expect(hrefs, `${r} ${h}`).not.toContain(h);
    }
  });

  it("Management no longer promises HR (there is no HR module)", () => {
    expect(NAV.find((g) => g.label === "Management")!.description).not.toMatch(/\bHR\b/);
  });

  it("the owner's menu is smaller than at the audit (118 entries, all unfolded)", () => {
    const items = navOf("owner_director").flatMap((g) => g.items);
    const unfolded = items.filter((i) => !i.advanced && i.section !== ADVANCED && i.section !== IT_SYSTEM);
    expect(items.length).toBeLessThan(118);
    expect(unfolded.length).toBeLessThanOrEqual(95);
  });

  it("Labels printed (ADR-099): in the menus of managers and QA, not of operators and warehouse staff", () => {
    for (const r of ["production_operator", "warehouse_operator"]) expect(navOf(r).flatMap((g) => g.items.map((i) => i.href)), r).not.toContain("/labels");
    for (const r of ["site_manager", "qa_qc", "owner_director"]) expect(section(r, "Inventory", "Counts & labels"), r).toContain("Labels printed");
  });

  it("old production screens are in no menu", () => {
    for (const r of Object.keys(ROLE_BUNDLES)) {
      const hrefs = navOf(r).flatMap((g) => g.items.map((i) => i.href));
      for (const h of ["/production/work-orders", "/production/new", "/production/staging", "/production/board"]) expect(hrefs, `${r} ${h}`).not.toContain(h);
    }
  });
});

describe("production tabs per role (ADR-080 §11)", () => {
  it("operators (ADR-083): only My work and Daily log in Operations, Stock and Scan in Inventory, no sections", () => {
    expect(productionPersona(canFor("production_operator"), ["production_operator"])).toBe("operator");
    expect(main("production_operator")).toEqual(["My work", "Today"]);
    expect(groupSections(group("production_operator", "Operations")!).sections).toEqual([]);
    expect(main("production_operator", "Inventory")).toEqual(["Stock", "Scan or search"]);
    expect(main("production_operator", "Home")).not.toContain("Problems & alerts");
  });

  it("warehouse (ADR-083): receiving and packing in Operations, all of Inventory, no production or sales", () => {
    expect(navOf("warehouse_operator").map((g) => g.label)).toEqual(["Home", "Operations", "Inventory"]);
    expect(groupSections(group("warehouse_operator", "Operations")!).sections.map((x) => x.name)).toEqual(["Receiving", "Packing & dispatch"]);
    expect(main("warehouse_operator", "Operations")).toEqual([]);
  });

  it("planner, site manager and owner: Production orders, Today, Rejects, New order", () => {
    for (const r of ["production_planner", "site_manager", "owner_director"]) {
      expect(main(r)).toEqual(expect.arrayContaining(["Operations Center", "Production orders", "Today", "Rejects"]));
      expect(section(r, "Operations", ADVANCED)).toEqual([]); // ADR-085: no "Older screens" in Operations
      expect(section(r, "Management", ADVANCED)).toEqual(expect.arrayContaining(["Production plan", "Batch records"]));
    }
  });

  it("Production setup sits in Management, not in Operations", () => {
    expect(section("owner_director", "Management", "Production setup")).toEqual(["Recipes", "How-to sheets", "Quality checks for each item", "Equipment", "Recipes (advanced)", "Steps (advanced)"]);
    // UX audit R2: the engineers' editing screens are folded under "Advanced" at the end of Production setup.
    const setup = groupSections(group("owner_director", "Management")!).sections.find((s) => s.name === "Production setup")!.items;
    // Round 4: "Quality checks for each item" folds for everyone but QA.
    expect(setup.filter((i) => i.advanced).map((i) => i.label)).toEqual(["Quality checks for each item", "Recipes (advanced)", "Steps (advanced)"]);
    expect(section("qa_qc", "Management", "Production setup")).toContain("Quality checks for each item");
    expect(groupSections(group("qa_qc", "Management")!).sections.find((s) => s.name === "Production setup")!.items.find((i) => i.label === "Quality checks for each item")!.advanced).toBe(false);
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
    expect(section("owner_director", "Operations", "Receiving")).toEqual(["Deliveries coming", "Receive a delivery", "Deliveries received", "Put away"]);
    expect(section("owner_director", "Operations", "Packing & dispatch")).toEqual(expect.arrayContaining(["Boxing", "To get from shelf", "Send out"]));
  });

  it("customer billing sits with Sales & Customers", () => {
    expect(section("owner_director", "Sales & Customers", "Billing & payments")).toEqual(["Invoices", "Payments", "Customer statements", "Credits (money back)"]);
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

  it("QA: Home · Check a batch or delivery · Operations · Scan · Menu (the tab word is the H1 of /quality, re-audit N10)", () => {
    expect(tabs("qa_qc").map((t) => t.label)).toEqual(["Home", "Check a batch or delivery", "Operations", "Scan", "Menu"]);
    expect(tabs("qa_qc").find((t) => t.label === "Check a batch or delivery")!.href).toBe("/quality");
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

describe("To approve only for approvers (ADR-082)", () => {
  it("roles without any approve permission do not get To approve, unless something waits for them", () => {
    const approver = (r: string, waiting: number) => isApprover(canFor(r), [r], ROLE_BUNDLES[r].permissions, waiting);
    expect(approver("owner_director", 0)).toBe(true);
    expect(approver("qa_qc", 0)).toBe(true);
    expect(approver("finance", 0)).toBe(true);
    expect(approver("production_operator", 0)).toBe(false); // floor sign-offs happen at the step
    expect(approver("warehouse_operator", 0)).toBe(false);
    expect(approver("sales_cs", 0)).toBe(false);
    expect(approver("production_operator", 2)).toBe(true);
    const home = (approver: boolean) => buildNav(canFor("production_operator"), ["production_operator"], { approver }).find((g) => g.label === "Home")!.items.map((i) => i.label);
    expect(home(false)).not.toContain("To approve");
    expect(home(true)).toContain("To approve");
  });
});

describe("Floor screen (ADR-084)", () => {
  it("office roles with production.batch.view get Floor screen (TV) in Operations; floor personas do not", () => {
    for (const r of ["owner_director", "site_manager", "production_planner"]) expect(main(r)).toContain("Floor screen (TV)");
    expect(main("production_operator")).not.toContain("Floor screen (TV)");
    expect(navOf("warehouse_operator").flatMap((g) => g.items.map((i) => i.href))).not.toContain("/floor");
    expect(navOf("sales_cs").flatMap((g) => g.items.map((i) => i.href))).not.toContain("/floor");
  });

  it("the Floor display role is read-only, site-scoped, and its home is the floor screen", () => {
    const b = ROLE_BUNDLES.floor_display;
    expect(b.orgWide).toBe(false);
    expect(b.permissions.every((p) => p.endsWith(".view"))).toBe(true);
    expect(productionPersona(canFor("floor_display"), ["floor_display"])).toBe("viewer");
    expect(navOf("floor_display").map((g) => g.label)).toEqual(["Home", "Operations"]);
    expect(main("floor_display")).toContain("Floor screen (TV)");
    expect(homeHref(["floor_display"])).toBe("/floor");
    expect(homeHref(["floor_display", "site_manager"])).toBe("/dashboard");
    expect(homeHref([])).toBe("/dashboard");
  });
});

describe("a smaller owner menu (round 4, UX re-audit C #6)", () => {
  const visible = (r: string) => navOf(r).flatMap((g) => g.items).filter((i) => !i.advanced);

  it("the owner sees at most 80 entries without opening an Advanced fold (113 unfolded at the re-audit: 103)", () => {
    expect(visible("owner_director").length).toBeLessThanOrEqual(80);
    expect(navOf("owner_director").flatMap((g) => g.items).length).toBeLessThanOrEqual(113); // nothing removed: folded
  });

  it("no role has a sub-menu that only opens Advanced, or a sub-menu with one entry (Planning tools and IT and system excepted)", () => {
    for (const r of Object.keys(ROLE_BUNDLES))
      for (const g of navOf(r))
        for (const sec of groupSections(g).sections) {
          if (sec.name === ADVANCED || sec.name === IT_SYSTEM) continue;
          const daily = sec.items.filter((i) => !i.advanced).length;
          // A destination with a single section has nothing to merge it into.
          if (groupSections(g).sections.filter((x) => x.name !== ADVANCED && x.name !== IT_SYSTEM).length === 1) continue;
          expect(daily, `${r} ${g.label} › ${sec.name}`).toBeGreaterThan(0);
          expect(sec.items.length, `${r} ${g.label} › ${sec.name}`).toBeGreaterThan(1);
        }
  });

  it("sales no longer sees an empty Purchasing sub-menu; the sales guess is still reachable (folded)", () => {
    const names = groupSections(group("sales_cs", "Management")!).sections.map((s) => s.name);
    expect(names).not.toContain("Purchasing");
    const guess = group("sales_cs", "Management")!.items.find((i) => i.href === "/procurement/forecast");
    expect(guess?.advanced).toBe(true);
  });

  it("the rare entries fold for the owner but stay daily for the people who use them", () => {
    const item = (r: string, href: string) => navOf(r).flatMap((g) => g.items).find((i) => i.href === href);
    expect(item("owner_director", "/quality/recalls")?.advanced).toBe(true);
    expect(item("qa_qc", "/quality/recalls")?.advanced).toBe(false);
    expect(item("owner_director", "/warehouse/repack")?.advanced).toBe(true);
    expect(item("warehouse_operator", "/warehouse/repack")?.advanced).toBe(false);
    expect(item("owner_director", "/finance/periods")?.advanced).toBe(true);
    expect(item("finance", "/finance/periods")?.advanced).toBe(false);
    expect(item("owner_director", "/admin/sessions")?.advanced).toBe(true);
    expect(item("system_admin", "/admin/sessions")?.advanced).toBe(false);
    expect(item("warehouse_operator", "/sync")?.advanced).toBe(false);
  });

  it("Recipes opens the plain recipe list; the advanced lists stay folded under Advanced", () => {
    const setup = groupSections(group("owner_director", "Management")!).sections.find((s) => s.name === "Production setup")!.items;
    expect(setup.find((i) => i.label === "Recipes")?.href).toBe("/masterdata/recipes");
    expect(setup.find((i) => i.href === "/masterdata/formulas")?.advanced).toBe(true);
  });

  it("people, rules and settings are one sub-menu", () => {
    const names = groupSections(group("owner_director", "Management")!).sections.map((s) => s.name);
    expect(names).toContain(PEOPLE_SETTINGS);
    expect(names).not.toContain("People & access");
    expect(names).not.toContain("Rules and settings");
  });
});

describe("ADR-110 C0 and C11: How work flows, and Purchasing in Operations for buyers", () => {
  it("How work flows is a main entry of Operations for office roles; floor roles keep their short menu", () => {
    for (const r of ["owner_director", "site_manager", "production_planner", "qa_qc", "sales_cs", "procurement", "finance"]) expect(main(r), r).toContain("How work flows");
    expect(main("warehouse_operator")).toEqual([]);
    expect(main("production_operator")).not.toContain("How work flows");
  });

  it("procurement finds Purchasing in Operations and no longer only under Management", () => {
    expect(section("procurement", "Operations", "Purchasing")).toEqual(expect.arrayContaining(["Purchasing", "Requests to buy", "Purchase orders"]));
    expect(section("procurement", "Management", "Purchasing")).toEqual([]);
    const doors = navOf("procurement").flatMap((g) => g.items.filter((i) => i.href === "/procurement/orders").map(() => g.label));
    expect(doors).toEqual(["Operations"]); // one door
  });

  it("everyone else keeps Purchasing under Management", () => {
    expect(section("owner_director", "Management", "Purchasing")).toContain("Requests to buy");
    expect(section("owner_director", "Operations", "Purchasing")).toEqual([]);
    expect(section("site_manager", "Operations", "Purchasing")).toEqual([]);
  });
});
