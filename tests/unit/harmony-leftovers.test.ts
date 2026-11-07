/**
 * Harmony leftovers (ADR-123, follow-up of ADR-119/121): the owner's desktop menu row fits at 1280 px, the last
 * PageHeader record pages move to RecordHeader, the QA lot status is a chip in the header, page-level next-step cards
 * fold into the header, long record forms use titled sections, and a page has one green button. Class and source
 * assertions here; the live measurements (Playwright, full demo, 1280–1920 px and 390/1440 px) are in
 * docs/ux-audit/harmony-review.md and tests/e2e/top-bar-fit.cjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The unit runner compiles JSX with the classic runtime; the UI modules are imported after this line.
(globalThis as unknown as { React: typeof React }).React = React;
const { NextStep } = await import("@/ui/guide");
const { RecordHeader } = await import("@/ui/record");
const { EditDetails, FormSection } = await import("@/ui/form-section");

const ROOT = join(__dirname, "../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("item 1: the desktop menu row fits at 1280 px", () => {
  it("from 1280 to 1535 px the top bar shows the logo mark, the full logo from 1536 px (156 px → 36 px, the row was 74 px short)", () => {
    const shell = src("src/app/(app)/shell.tsx");
    expect(shell).toMatch(/<LogoMark className="[^"]*\bxl:block\b[^"]*\b2xl:hidden\b/);
    expect(shell).toMatch(/<Logo className="[^"]*\bxl:hidden\b[^"]*\b2xl:block\b/);
  });
  it("the master search launcher and the site selector stay in the bar", () => {
    const shell = src("src/app/(app)/shell.tsx");
    expect(shell).toContain("<MasterSearchLauncher");
    expect(shell).toContain("siteSwitcher(false)");
  });
});

describe("item 2: person and job pages use the record template", () => {
  for (const f of ["src/app/(app)/admin/users/[id]/page.tsx", "src/app/(app)/admin/roles/[id]/page.tsx"]) {
    it(f, () => {
      const s = src(f);
      expect(s).toContain("<RecordHeader");
      expect(s).not.toMatch(/<PageHeader\b/);
      // Setup-style: the name is the hero (no `reference`), the back link is the list.
      expect(s).not.toMatch(/reference=/);
      expect(s).toMatch(/back=\{\{ href: "\/admin\/(users|roles)"/);
    });
  }
});

describe("item 3: the QA lot status is a chip in the header", () => {
  const s = src("src/app/(app)/quality/lots/[lotId]/page.tsx");
  it("RecordHeader gets the QaStatusChip; no status title banner below", () => {
    expect(s).toMatch(/chip=\{<QaStatusChip status=\{lot\.qualityStatus\} \/>\}/);
    expect(s).not.toMatch(/banner\.title/);
    expect(s).not.toMatch(/const BANNER\b/);
  });
  it("an OK lot has no message below (the chip says it); stopped lots say what it means in one sentence", () => {
    const notice = s.slice(s.indexOf("const NOTICE"), s.indexOf("const HINT"));
    expect(notice).not.toMatch(/released:/);
    expect(notice).toMatch(/quarantine: "Nobody can use, set aside or ship this lot until QA says it is OK\."/);
  });
});

describe("item 4: page-level next-step cards fold into the header", () => {
  it("the production order has no Next step card of its own", () => {
    const s = src("src/app/(app)/production/orders/[workOrderId]/page.tsx");
    expect(s).not.toMatch(/CardTitle>Next step</);
    expect(s).not.toContain("NextActionCard");
    expect(s).toContain("{...nextSlots(v, planKey, approvalNext)}");
    // Same controls as before.
    expect(s).toContain("<PlanBatchButton");
    expect(s).toContain("<ApproveButton");
    expect(s).toContain('data-testid="order-not-ready"');
  });
  it("the item page's main action is the header's button; the rest in ⋯ More", () => {
    const s = src("src/app/(app)/inventory/items/[kind]/[id]/page.tsx");
    expect(s).toMatch(/primary=\{\s*main \?/);
    expect(s).toContain("<MoreMenu compact>");
    expect(s).not.toMatch(/<div className="flex w-full flex-wrap items-start gap-2 sm:w-auto" data-testid="item-actions">/);
  });
  it("a jump to a form on the same page is not a second green button", () => {
    const jump = renderToStaticMarkup(createElement(NextStep, { text: "Decide", action: { label: "Decide now", href: "#decide" } }));
    expect(jump).toContain('data-jump="true"');
    expect(jump).not.toContain("bg-cta");
    const go = renderToStaticMarkup(createElement(NextStep, { text: "Go", action: { label: "Open", href: "/quality" } }));
    expect(go).toContain("bg-cta");
  });
  it("RecordHeader's next box takes block content (a warning line, who can help)", () => {
    const html = renderToStaticMarkup(createElement(RecordHeader, { typeLabel: "Production order", reference: "WO-1", next: createElement("div", { id: "blk" }, "x"), waitingFor: createElement("div", { id: "who" }, "y") }));
    expect(html).not.toMatch(/<p(?:\s[^>]*)?>(?:(?!<\/p>).)*<div id="blk"/);
    expect(html).not.toMatch(/<p(?:\s[^>]*)?>(?:(?!<\/p>).)*<div id="who"/);
  });
});

describe("item 5: long record forms use titled sections", () => {
  it("FormSection: the title is the legend in the section role; `more` is folded", () => {
    const html = renderToStaticMarkup(createElement(FormSection, { title: "What it is", more: createElement("input", { name: "x" }) }, createElement("input", { name: "a" })));
    expect(html).toMatch(/<fieldset[^>]*>.*<legend class="[^"]*text-section[^"]*">What it is<\/legend>/);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>More \(you can skip this\)<\/summary>.*name="x"/);
    expect(html).not.toMatch(/<details[^>]*open/);
  });
  it("EditDetails: closed by default, titled in the section role", () => {
    const html = renderToStaticMarkup(createElement(EditDetails, null, "form"));
    expect(html).toMatch(/<details id="edit"/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("Change the details");
  });
  const FORMS: [string, number][] = [
    ["src/app/(app)/masterdata/materials/material-fields.tsx", 4],
    ["src/app/(app)/masterdata/products/product-fields.tsx", 3],
    ["src/app/(app)/masterdata/suppliers/supplier-form.tsx", 3],
    ["src/app/(app)/masterdata/reason-codes/reason-fields.tsx", 3],
    ["src/app/(app)/masterdata/sites/[id]/page.tsx", 1],
    ["src/app/(app)/masterdata/locations/[id]/page.tsx", 1],
  ];
  for (const [f, n] of FORMS)
    it(`${f} has ${n} titled section(s)`, () => {
      expect((src(f).match(/<FormSection\b/g) ?? []).length).toBeGreaterThanOrEqual(n);
    });
  it("setup pages fold the edit form so the next step keeps the one green button", () => {
    for (const f of ["materials/[id]", "products/[id]", "suppliers/[id]", "sites/[id]", "locations/[id]"]) expect(src(`src/app/(app)/masterdata/${f}/page.tsx`), f).toContain("<EditDetails");
  });
});
