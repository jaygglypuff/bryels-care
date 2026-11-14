/**
 * ADR-136 (owner 2026-11-14: "the UI is ugly, feels AI-ish … a lot of navigation problems"): phase 1 of the desktop
 * redesign. The sidebar shows the whole menu of a job (no "More" dropdowns), the top bar says where you are
 * (breadcrumb), the page intro moved into the "?" panel, the big green "What to do next" box became one compact line,
 * list pages use underline tabs with counts and a data table, and controls are 6 px rectangles instead of pills.
 * Behaviour and permissions are unchanged: menus still come from buildNav (nav-per-role.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { buildNav, crumbsFor, groupEntries } from "@/app/(app)/nav";

// The unit runner compiles JSX with the classic runtime; the UI modules are imported after this line.
(globalThis as unknown as { React: typeof React }).React = React;
const { PageIntro, NextStep } = await import("@/ui/guide");
const { FilterTabs } = await import("@/ui/plain-list");
const { Callout, DataTable, Tabs, sortRows, readSort } = await import("@/ui/kit");
const { buttonClass } = await import("@/ui/core");
const { StatusChip } = await import("@/ui/status");

const ROOT = join(__dirname, "../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const canFor = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};
const navOf = (role: string) => buildNav(canFor(role), [role]);

describe("sidebar: the whole menu of a job, no More dropdowns", () => {
  it("each area lists its tabs and its former More entries in one flat list", () => {
    const make = navOf("owner_director").find((g) => g.label === "Make")!;
    const hrefs = groupEntries(make).map((i) => i.href);
    expect(hrefs.slice(0, 2)).toEqual(["/operations", "/production/orders"]);
    // Batch records and Today were behind "More"; they are listed in the sidebar now.
    expect(hrefs).toContain("/production");
    expect(hrefs).toContain("/production/today");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("the shell draws the tree, remembers the narrow sidebar safely and has a skip link", () => {
    const shell = src("src/app/(app)/shell.tsx");
    expect(shell).toContain('data-testid="sidebar"');
    expect(shell).toContain("groupEntries(g)");
    expect(shell).not.toMatch(/desktop-more|desktop-tab-row/);
    // localStorage may throw (private mode): every read and write is guarded.
    expect(shell).toMatch(/const readStore = [\s\S]*?try \{[\s\S]*?localStorage\.getItem[\s\S]*?catch/);
    expect(shell).toMatch(/const writeStore = [\s\S]*?try \{[\s\S]*?localStorage\.setItem[\s\S]*?catch/);
    expect(src("src/app/(app)/layout.tsx")).toMatch(/try\{if\(localStorage\.getItem\("bc\.sidebar"\)==="collapsed"\)/);
    expect(shell).toContain("Skip to the page");
    // Arrow keys move through the menu.
    expect(shell).toMatch(/onKeyDown=\{arrowKeys\}/);
  });
});

describe("breadcrumb: Section / Page / record", () => {
  const owner = navOf("owner_director");
  it("a list page: area and page, the page not a link", () => {
    expect(crumbsFor(owner, "/sales")).toEqual({ crumbs: [{ label: "Sell" }, { label: "Customer orders", href: undefined }], exact: true });
  });
  it("a record under it: the page is a link back, the shell adds the record number", () => {
    const r = crumbsFor(owner, "/sales/0b6c7a8e-1111-4222-8333-944445555666");
    expect(r.exact).toBe(false);
    expect(r.crumbs).toEqual([{ label: "Sell" }, { label: "Customer orders", href: "/sales" }]);
    expect(src("src/app/(app)/shell.tsx")).toContain('main [data-testid=record-number]');
  });
  it("Home says Home once; a set-up screen outside the menu says where it lives", () => {
    expect(crumbsFor(owner, "/dashboard").crumbs).toEqual([{ label: "Home", href: undefined }]);
    expect(crumbsFor(owner, "/admin/settings").crumbs).toEqual([{ label: "Set-up" }, { label: "Settings", href: undefined }]);
  });
});

describe("page intro → the '?' panel", () => {
  it("PageIntro keeps its sentence in the page for the Help panel to read", () => {
    const html = renderToStaticMarkup(createElement(PageIntro, null, "This screen is for the orders customers give us."));
    expect(html).toContain("data-page-intro");
    expect(html).toContain('data-testid="page-intro-text"');
    expect(html).toContain("This screen is for the orders customers give us.");
  });
  it("where the frame has its '?', the sentence is hidden under the title and shown as 'About this screen'", () => {
    expect(src("src/app/globals.css")).toMatch(/^\[data-frame-help\] \.page-intro \{ display: none; \}/m);
    const help = src("src/ui/help/frame-help.tsx");
    expect(help).toContain('"main [data-page-intro] [data-testid=page-intro-text]"');
    expect(help).toContain("About this screen");
  });
});

describe("one compact line for what to do next", () => {
  it("NextStep is a Callout: labelled for screen readers, no big green box", () => {
    const html = renderToStaticMarkup(createElement(NextStep, { text: "Next: confirm the order.", action: { label: "Confirm", href: "/x" } }));
    expect(html).toContain('aria-label="What to do next"');
    expect(html).toContain("next-callout");
    expect(html).not.toContain("--brand-50");
    expect(html).toContain("Next: confirm the order.");
  });
  it("the record header uses the same line", () => {
    expect(src("src/ui/record.tsx")).toMatch(/<Callout className="mb-0 mt-4"/);
    const html = renderToStaticMarkup(createElement(Callout, { waitingFor: "Dino approves it.", children: "This order needs approval." }));
    expect(html).toContain("Dino approves it.");
  });
});

describe("list pattern: tabs with counts, a data table", () => {
  it("FilterTabs became underline tabs; a '(3)' count becomes the grey count", () => {
    const html = renderToStaticMarkup(createElement(FilterTabs, { label: "Status", active: "open", tabs: [["open", "Open (3)", "/x?s=open"], ["all", "All", "/x"]] }));
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/>Open<span[^>]*>3<\/span>/);
    expect(html).toContain("border-b-2");
    expect(html).not.toContain("rounded-full");
  });
  it("Tabs: the active tab is marked for screen readers", () => {
    const html = renderToStaticMarkup(createElement(Tabs, { label: "x", active: "b", items: [{ key: "a", label: "A", href: "/a" }, { key: "b", label: "B", href: "/b", count: 2 }] }));
    const b = html.match(/<a [^>]*href="\/b"[^>]*>/)?.[0] ?? "";
    expect(b).toContain('aria-current="page"');
  });
  it("DataTable: whole-row link, the primary cell a real link, sortable headers with aria-sort, right-aligned numbers", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<{ id: string; name: string; value: string }>, {
        label: "Orders",
        rows: [{ id: "1", name: "Isla Spa", value: "8880.00" }],
        rowKey: (r) => r.id,
        rowHref: (r) => `/sales/${r.id}`,
        sort: { key: "name", dir: "asc", href: (k, d) => `?sort=${k}&dir=${d}` },
        columns: [
          { key: "name", header: "Customer", primary: true, sortable: true, cell: (r) => r.name },
          { key: "value", header: "Value", align: "right", cell: (r) => r.value },
        ],
      }),
    );
    expect(html).toContain('data-href="/sales/1"');
    expect(html).toMatch(/<a [^>]*href="\/sales\/1"[^>]*>Isla Spa<\/a>/);
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('href="?sort=name&amp;dir=desc"');
    expect(html).toMatch(/text-right tabular[^"]*">8880\.00/);
    expect(src("src/app/(app)/shell.tsx")).toContain("<RowClicks />");
  });
  it("sorting compares money and quantities as decimals, never as floats or text", () => {
    const rows = [{ v: "10.5" }, { v: "9.25" }, { v: "100" }, { v: "0.1" }];
    expect(sortRows(rows, "asc", (r) => r.v).map((r) => r.v)).toEqual(["0.1", "9.25", "10.5", "100"]);
    expect(sortRows(rows, "desc", (r) => r.v).map((r) => r.v)).toEqual(["100", "10.5", "9.25", "0.1"]);
    expect(readSort({ sort: "evil", dir: "up" }, ["name"], { key: "", dir: "desc" })).toEqual({ key: "", dir: "desc" });
  });
  it("Customer orders: no stat cards repeating the tab counts", () => {
    const page = src("src/app/(app)/sales/page.tsx");
    expect(page).not.toMatch(/<Kpi\b/);
    expect(page).toContain("<DataTable");
    expect(page).toContain("<ListToolbar");
  });
});

describe("tokens: rectangles, not pills", () => {
  it("buttons are 6 px with 36 px for a mouse and 44 px on touch screens", () => {
    const c = buttonClass("primary", "md");
    expect(c).toContain("rounded-[6px]");
    expect(c).toContain("min-h-[36px]");
    expect(c).toContain("pointer-coarse:min-h-[44px]");
    expect(c).not.toContain("rounded-full");
    expect(buttonClass("primary", "lg")).toContain("pointer-coarse:min-h-[52px]");
  });
  it("status badges are 4 px, with an icon and a word", () => {
    const html = renderToStaticMarkup(createElement(StatusChip, { status: "released" }));
    expect(html).toContain("rounded-[4px]");
    expect(html).toContain("<svg");
    expect(html).toContain("Released");
  });
  it("neutral surfaces; green only for primary, links, the active entry and focus; Inter for headings", () => {
    const css = src("src/app/globals.css");
    expect(css).toMatch(/--bg: #f7f8fa; --surface: #ffffff;/);
    expect(css).toMatch(/--border: #e4e7ec;/);
    expect(css).toMatch(/--fg: #101828; --fg-2: #475467;/);
    expect(css).toMatch(/--font-display: var\(--font\);/);
    expect(css).toMatch(/:root\[data-theme="dark"\] \{/);
    expect(css).toMatch(/\[data-tv-theme="dark"\] \{/);
  });
  it("no page uses a pill except avatars, dots, bars and switches (floor TV and print excepted)", () => {
    const files = ["src/app/(app)/sales/page.tsx", "src/app/(app)/production/orders/page.tsx", "src/app/(app)/inventory/page.tsx", "src/app/(app)/approvals/page.tsx", "src/app/(app)/admin/settings/page.tsx", "src/app/(app)/dashboard/owner-home.tsx", "src/ui/kit.tsx", "src/ui/status.tsx", "src/ui/plain-list.tsx", "src/ui/more-menu.tsx"];
    for (const f of files) expect(src(f).match(/rounded-full/g) ?? [], f).toHaveLength(f.endsWith("kit.tsx") ? 1 : 0);
  });
});

describe("Home: a standard dashboard", () => {
  it("no greeting; KPI tiles; the Needs you panel first", () => {
    const home = src("src/app/(app)/dashboard/owner-home.tsx");
    expect(home).not.toMatch(/Good morning|greetingOf/);
    expect(home).toContain('title="Home"');
    expect(home).toContain('testId="home-needs"');
    expect(home).toContain("<KpiTile");
  });
});
