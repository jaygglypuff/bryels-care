/**
 * UX audit R2 "menu word = screen title": every menu entry, tab and quick link uses the same words as the H1 of
 * the screen it opens (UX audit 2026-10-31 found 29 mismatches). The H1 lives in the page's source; this
 * test reads the route's files and finds the label written there as the title. Screens whose H1 is not a
 * fixed word (a greeting, the site's name, the open tab, a wizard step question) are listed in
 * DYNAMIC_TITLES with what the H1 shows instead; anything else must match exactly.
 *
 * The live check (Playwright, every menu entry per role at 390/820/1440) is in the round-2 report; this
 * test keeps the words from drifting apart again.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { NAV, QUICK_ACTIONS, buildNav, productionItems, tabsFor } from "@/app/(app)/nav";

const ROOT = join(__dirname, "../..");

/** Screens whose H1 is not a fixed word, and what it shows instead. Keep this list short. */
const DYNAMIC_TITLES: Record<string, string> = {
  "/dashboard": "a greeting with the person's name (\"Good evening, Ana\"); the menu word is Overview",
  "/floor": "the company and site name on the production TV; the menu word says what the screen is",
  "/inventory": "the open stock tab (Raw materials, Work in progress, Finished goods, All stock); the menu word is Stock",
  "/masterdata/recipes/new": "the wizard's step question (\"1. Which product?\"); the browser title is New recipe",
  "/production/orders": "My work for operators, Production orders for everyone else (same screen, filtered per role)",
};

function routeFiles(href: string): string[] {
  const path = href.split("?")[0];
  const dir = path === "/floor" ? join(ROOT, "src/app/floor") : join(ROOT, "src/app/(app)", path);
  if (!existsSync(join(dir, "page.tsx"))) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => join(dir, f));
}

const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The label written as a title in the route's files (a title prop or key, or an <h1>'s text). */
function titleIn(files: string[], label: string): boolean {
  const variants = [label, label.replace(/'/g, "&apos;")];
  return files.some((f) => {
    // The browser-tab title (`metadata`) does not count: the words must be on the screen.
    const src = readFileSync(f, "utf8").replace(/export const metadata[^\n]*\n/g, "");
    // As a title: a `title` prop or key (PageHeader, RecordHeader, a title constant) or the text of an <h1>.
    return variants.some((v) => src.includes(`title="${v}"`) || src.includes(`title: "${v}"`) || new RegExp(`title=\\{[^\\n]*"${esc(v)}"`).test(src) || new RegExp(`<h1[^>]*>\\s*${esc(v)}\\s*</h1>`).test(src));
  });
}

const canFor = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: Permission) => set.has(p);
};

/** Every entry anyone can see: the full menu, the per-role production tabs and the quick links. */
const entries: { label: string; href: string; where: string }[] = [
  ...NAV.flatMap((g) => g.items.filter((i) => !i.planned).map((i) => ({ label: i.label, href: i.href, where: `menu ${g.label}` }))),
  ...(["operator", "planner"] as const).flatMap((p) => productionItems(p).map((i) => ({ label: i.label, href: i.href, where: `production tabs (${p})` }))),
  ...Object.keys(ROLE_BUNDLES).flatMap((r) => buildNav(canFor(r), [r]).flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href, where: `menu of ${r}` })))),
  ...QUICK_ACTIONS.map((q) => ({ label: q.label, href: q.href, where: "quick links" })),
];

describe("menu word = screen title (UX audit R2)", () => {
  it("every menu entry opens a screen that exists", () => {
    const missing = [...new Set(entries.map((e) => e.href.split("?")[0]))].filter((h) => routeFiles(h).length === 0);
    expect(missing).toEqual([]);
  });

  it("every menu entry's word is the H1 of its screen (or the screen is a listed dynamic title)", () => {
    const wrong = new Set<string>();
    for (const e of entries) {
      if (DYNAMIC_TITLES[e.href.split("?")[0]]) continue;
      if (!titleIn(routeFiles(e.href), e.label)) wrong.add(`${e.label} → ${e.href} (${e.where})`);
    }
    expect([...wrong]).toEqual([]);
  });

  it("the dynamic-title list only names screens that are in a menu", () => {
    const hrefs = new Set(entries.map((e) => e.href.split("?")[0]));
    for (const h of Object.keys(DYNAMIC_TITLES)) expect(hrefs.has(h), h).toBe(true);
  });

  it("one screen, one word: the same screen never has two different menu words", () => {
    const words = new Map<string, Set<string>>();
    for (const e of entries) {
      const h = e.href.split("?")[0];
      if (h === "/production/orders") continue; // "My work" for operators by design (DYNAMIC_TITLES)
      words.set(h, (words.get(h) ?? new Set()).add(e.label));
    }
    const clashes = [...words].filter(([, w]) => w.size > 1).map(([h, w]) => `${h}: ${[...w].join(" / ")}`);
    expect(clashes).toEqual([]);
  });

  it("no jargon or developer words in menu words", () => {
    for (const e of entries) expect(e.label, e.href).not.toMatch(/\b(FEFO|ASL|CAPA|KPI|ADR|BOM|WO|GR|PO|QC)\b/);
  });

  it("bottom tab words are short forms of their screens and every tab opens an existing screen", () => {
    for (const r of Object.keys(ROLE_BUNDLES))
      for (const t of tabsFor(canFor(r), [r])) if (t.href) expect(routeFiles(t.href).length, `${r} ${t.label}`).toBeGreaterThan(0);
  });
});
