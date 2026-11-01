/**
 * Round 4 of the UX fixes (live re-audit C, 2026-11-01): the plain recipe list, the frame's Help "?", 44 px targets
 * inside pages, title → intro → buttons on phones, one green Approve and the connected stage strip. Class and
 * source assertions here; the live measurements (Playwright at 390/820/1440) are in docs/ux-audit/README.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recipeRowAction, recipeStatusWords } from "@/app/(app)/masterdata/recipes/recipe-list";
import { GUIDE_FILES } from "@/ui/help/guides";
import { SCREEN_GUIDES, guideKeyFor } from "@/ui/help/screen-guides";

const ROOT = join(__dirname, "../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("plain recipe list (UX re-audit C #5)", () => {
  const can = { edit: true, newVersion: true };
  it("a draft gets Edit recipe; a recipe in use gets Make a new version; waiting or read-only gets Open", () => {
    expect(recipeRowAction({ effective: null, open: { revisionNo: 1, status: "draft" }, scheduled: null }, can, "f1")).toEqual({ label: "Edit recipe", href: "/masterdata/recipes/f1?edit=1", kind: "edit" });
    expect(recipeRowAction({ effective: { revisionNo: 2, status: "approved" }, open: null, scheduled: null }, can, "f1")).toEqual({ label: "Make a new version", href: "/masterdata/recipes/f1?new=1", kind: "new" });
    expect(recipeRowAction({ effective: { revisionNo: 2, status: "approved" }, open: { revisionNo: 3, status: "pending_approval" }, scheduled: null }, can, "f1").kind).toBe("open");
    expect(recipeRowAction({ effective: { revisionNo: 2, status: "approved" }, open: null, scheduled: null }, { edit: false, newVersion: false }, "f1").kind).toBe("open");
  });
  it("says the version status in words", () => {
    expect(recipeStatusWords({ effective: { revisionNo: 1, status: "approved" }, open: null, scheduled: null })).toBe("Version 1 in use");
    expect(recipeStatusWords({ effective: { revisionNo: 1, status: "approved" }, open: { revisionNo: 2, status: "pending_approval" }, scheduled: null })).toBe("Version 1 in use · version 2 waits for an OK");
    expect(recipeStatusWords({ effective: null, open: null, scheduled: null })).toBe("No version yet");
  });
  it("the recipe list is a page (not a redirect) and the wizard and recipe page go back to it", () => {
    expect(src("src/app/(app)/masterdata/recipes/page.tsx")).not.toMatch(/redirect\(/);
    for (const f of ["src/app/(app)/masterdata/recipes/new/page.tsx", "src/app/(app)/masterdata/recipes/[formulaId]/page.tsx"]) expect(src(f), f).not.toMatch(/href="\/masterdata\/formulas"/);
  });
});

describe("frame Help (UX re-audit C #9)", () => {
  it("every pattern names a published guide", () => {
    for (const [, key] of SCREEN_GUIDES) expect(GUIDE_FILES[key], key).toBeDefined();
  });
  it("the most specific screen wins; other screens get the role guide", () => {
    expect(guideKeyFor("/inventory/receive/put-away", [])).toBe("inventory.putaway");
    expect(guideKeyFor("/inventory/receive", [])).toBe("inventory.receive");
    expect(guideKeyFor("/production/orders/abc/weigh", [])).toBe("production.weigh");
    expect(guideKeyFor("/production/orders", [])).toBe("production.production_order");
    expect(guideKeyFor("/sales/dispatch", [])).toBe("sales.fulfilment");
    expect(guideKeyFor("/dashboard", ["owner_director"])).toBe("role.owner");
    expect(guideKeyFor("/finance", ["finance"])).toBe("role.site_manager");
    expect(guideKeyFor("/finance", [])).toBe("start.everyday_basics");
  });
  it("the shell shows one 44 px Help button on every screen", () => {
    expect(src("src/ui/help/frame-help.tsx")).toMatch(/h-11 min-w-11/);
    expect(src("src/app/(app)/shell.tsx")).toMatch(/<FrameHelp load=\{loadHelp\}/);
    expect(src("src/app/(app)/layout.tsx")).toMatch(/loadHelp=\{helpForScreen\}/);
  });
});

describe("44 px targets inside pages (UX re-audit C #2)", () => {
  it("Chart/Table toggle, Sign out, stage warnings, Edit and Change or confirm are 44 px", () => {
    expect(src("src/ui/charts/chart-frame.tsx")).toMatch(/min-h-\[44px\] min-w-\[44px\] rounded-full/);
    expect(src("src/app/(app)/account/page.tsx")).toMatch(/min-h-\[44px\][^"]*">Sign out</);
    expect(src("src/ui/pipeline.tsx")).toMatch(/min-h-\[44px\][^"]*" data-testid="stage-warning"/);
    expect(src("src/app/(app)/masterdata/uom/page.tsx")).toMatch(/min-h-\[44px\][^"]*">Edit</);
    expect(src("src/app/(app)/admin/retention/page.tsx")).toMatch(/min-h-\[44px\][^"]*">\{canEdit \? "Change or confirm"/);
  });
  it("Problems & alerts: 44 px kind chips, folded on phones; one Add a note button instead of a note box per row", () => {
    const page = src("src/app/(app)/action-centre/page.tsx");
    expect(page).toMatch(/inline-flex min-h-\[44px\] items-center rounded-full border px-4 text-\[13px\]/);
    expect(page).toMatch(/<details className="mb-3 sm:hidden"/);
    const form = src("src/app/(app)/action-centre/forms.tsx");
    expect(form).toMatch(/Add a note/);
    expect(form).toMatch(/note \? \(/);
  });
  it("checkbox and radio label rows are 44 px however the label is written (globals.css)", () => {
    const css = src("src/app/globals.css");
    expect(css).toMatch(/label:has\(input\[type="checkbox"\]\), label:has\(input\[type="radio"\]\) \{ min-height: 44px/);
    expect(css).toMatch(/input\[type="checkbox"\] \+ label, input\[type="radio"\] \+ label \{ display: inline-flex; min-height: 44px/);
  });
  it("disclosure summaries in the screens owned here are 44 px", () => {
    for (const f of ["src/app/(app)/admin/retention/page.tsx", "src/app/(app)/admin/devices/forms.tsx", "src/app/(app)/admin/diagnostics/page.tsx", "src/app/(app)/masterdata/_org/ui.tsx"])
      expect(src(f), f).not.toMatch(/<summary className="cursor-pointer /);
  });
});

describe("frame and page layout (UX re-audit C #8, #9, #10)", () => {
  it("phones: title, then the intro, then the header buttons (generic, in PageHeader + PageIntro + globals.css)", () => {
    expect(src("src/ui/core.tsx")).toMatch(/className="page-header /);
    expect(src("src/ui/core.tsx")).toMatch(/className="page-actions /);
    expect(src("src/ui/guide.tsx")).toMatch(/className="page-intro /);
    expect(src("src/app/globals.css")).toMatch(/\.page-header--actions \+ \.page-intro \{ order: -2/);
    expect(src("src/app/globals.css")).not.toMatch(/:has\([^)]*:has\(/); // :has() inside :has() is invalid CSS: the browser drops the rule
  });
  it("the site selector shows the site name only, never cut (no max width, no code first)", () => {
    const shell = src("src/app/(app)/shell.tsx");
    expect(shell).not.toMatch(/\{s\.code\} · \{s\.name\}/);
    expect(shell).not.toMatch(/max-w-\[150px\]/);
  });
  it("To approve: only the first row's Approve is green", () => {
    expect(src("src/app/(app)/approvals/page.tsx")).toMatch(/first=\{n === 0\}/);
    expect(src("src/app/(app)/approvals/forms.tsx")).toMatch(/variant=\{primary \? "primary" : "secondary"\}/);
  });
  it("Operations Center stages: a connected strip (arrows) on wide screens, a wrapping two-column list on phones", () => {
    const p = src("src/ui/pipeline.tsx");
    expect(p).toMatch(/grid grid-cols-2/);
    expect(p).not.toMatch(/overflow-x-auto/);
    expect(p).toMatch(/data-testid="stage-arrow"/);
  });
});
