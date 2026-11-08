/**
 * Screens in the master search (owner request 2026-11-08): category words and their synonyms find menu entries, and
 * an entry never shows to someone without its permission.
 */
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { NAV } from "@/app/(app)/nav";
import { SCREEN_SYNONYMS, allScreens, commonScreens, searchScreens, synonymTargets } from "@/app/(app)/search-screens";

const everyone = (_p: Permission) => true;
const bundle = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};
const OWNER = ["owner_director"];
const hrefs = (q: string, can = everyone, roles: string[] = OWNER) => searchScreens(q, can, roles).map((s) => s.href);
const labels = (q: string, can = everyone, roles: string[] = OWNER) => searchScreens(q, can, roles).map((s) => s.label);

describe("synonyms → screens", () => {
  it.each([
    ["bills", "/finance/bills"],
    ["bill", "/finance/bills"],
    ["Bills", "/finance/bills"],
    ["invoices", "/finance/invoices"],
    ["lot", "/inventory"],
    ["lots", "/inventory/lots/expiry"],
    ["PO", "/procurement/orders"],
    ["purchase orders", "/procurement/orders"],
    ["SO", "/sales"],
    ["orders", "/sales"],
    ["work order", "/production/orders"],
    ["deviation", "/quality/deviations"],
    ["CAPA", "/quality/capa"],
    ["GRN", "/inventory/receipts"],
    ["receipt", "/inventory/receipts"],
    ["receive", "/inventory/receive"],
    ["QA", "/quality"],
    ["recipes", "/masterdata/recipes"],
    ["stock", "/inventory"],
    ["suppliers", "/procurement/suppliers"],
    ["customers", "/sales/customers"],
    ["boxes", "/inventory/containers"],
  ])("%s → %s", (q, href) => {
    expect(hrefs(q)).toContain(href);
  });

  it("the synonym comes first (bills → Supplier bills before anything else)", () => {
    expect(labels("bills")[0]).toBe("Supplier bills");
    expect(labels("CAPA")[0]).toBe("Fix-and-prevent plans");
  });

  it("'master data' and 'setup' list the set-up section entries (all of them, up to 10)", () => {
    for (const q of ["master data", "setup", "Master Data"]) {
      const h = hrefs(q);
      expect(h).toEqual(expect.arrayContaining(["/masterdata/materials", "/masterdata/products", "/masterdata/recipes", "/masterdata/equipment"]));
      expect(h.length).toBeGreaterThan(6);
      expect(h.length).toBeLessThanOrEqual(10);
    }
    expect(searchScreens("master data", everyone, OWNER)[0].where).toBe("Set-up › Products and recipes");
  });

  it("menu words work too (prefix of the words: 'supp bi', 'expir')", () => {
    expect(hrefs("supp bi")).toContain("/finance/bills");
    expect(hrefs("expir")).toContain("/inventory/lots/expiry");
    expect(hrefs("Fix-and-prevent")).toContain("/quality/capa");
  });

  it("every synonym points at a menu entry or a menu section (no dead links)", () => {
    const screens = new Set(allScreens().map((s) => s.href));
    const sections = new Set(NAV.flatMap((g) => g.items.map((i) => i.section)).filter(Boolean));
    for (const [word, targets] of Object.entries(SCREEN_SYNONYMS)) {
      expect(word).toBe(word.toLowerCase());
      for (const t of targets) {
        if (t.startsWith("section:")) expect(sections.has(t.slice(8)), `${word} → ${t}`).toBe(true);
        else expect(screens.has(t), `${word} → ${t}`).toBe(true);
      }
    }
  });

  it("plurals are folded (bills, boxes, categories)", () => {
    expect(synonymTargets("bills")).toEqual(synonymTargets("bill"));
    expect(synonymTargets("boxes")).toEqual(synonymTargets("box"));
  });

  it("one letter, numbers and nothing find no screen", () => {
    expect(hrefs("b")).toEqual([]);
    expect(hrefs("")).toEqual([]);
    expect(hrefs("26-00001")).toEqual([]);
  });
});

describe("screens are filtered by permission", () => {
  it("a warehouse operator searching 'bills' gets no finance screen", () => {
    const can = bundle("warehouse_operator");
    expect(can("finance.supplier_bill.view")).toBe(false);
    expect(hrefs("bills", can, ["warehouse_operator"])).not.toContain("/finance/bills");
    expect(hrefs("money", can, ["warehouse_operator"]).some((h) => h.startsWith("/finance") && h !== "/finance/expenses")).toBe(false);
  });

  it("finance finds Supplier bills", () => {
    expect(hrefs("bills", bundle("finance"), ["finance"])).toContain("/finance/bills");
  });

  it("no entry is returned without its permission, for any role and any synonym", () => {
    const all = NAV.flatMap((g) => g.items);
    for (const role of Object.keys(ROLE_BUNDLES)) {
      const can = bundle(role);
      for (const word of Object.keys(SCREEN_SYNONYMS)) {
        for (const hit of searchScreens(word, can, [role])) {
          const item = all.find((i) => i.href === hit.href)!;
          const perms = item.permission === undefined ? [] : typeof item.permission === "string" ? [item.permission] : item.permission;
          expect(perms.length === 0 || perms.some((p) => can(p)), `${role} "${word}" → ${hit.href}`).toBe(true);
          if (item.roles) expect(item.roles).toContain(role);
        }
      }
    }
  });

  it("IT and system entries need the role, not only the permission", () => {
    const can = (p: Permission) => (PERMISSIONS as readonly string[]).includes(p);
    expect(hrefs("import", can, ["finance"])).not.toContain("/admin/imports");
    expect(hrefs("import", can, ["system_admin"])).toContain("/admin/imports");
  });

  it("common screens follow the role and the permissions", () => {
    expect(commonScreens(bundle("finance"), ["finance"]).map((s) => s.href)[0]).toBe("/finance/bills");
    expect(commonScreens(bundle("warehouse_operator"), ["warehouse_operator"]).map((s) => s.href)).not.toContain("/finance/bills");
    expect(commonScreens(bundle("warehouse_operator"), ["warehouse_operator"]).length).toBeGreaterThan(0);
  });
});
