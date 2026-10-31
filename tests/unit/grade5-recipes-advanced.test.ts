import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daysToWholeMonths, monthsToDays } from "@/modules/masterdata/products-shelf-life";

/**
 * Grade-5 standard (ADR-088, docs/PAGE_REVIEW.md) for the recipe "advanced editing" screens behind the
 * step-by-step recipe (ADR-089/094): products and sellable items, recipes (advanced), steps (advanced)
 * and how-to sheets. Every screen says what it is for, none asks the user to type a code (the server
 * numbers products, sellable items, recipes, steps and how-to sheets, ADR-093), the recipe and steps
 * screens point to New recipe (step by step) first, and the old jargon is not shown as a title.
 */
const ROOT = join(__dirname, "..", "..", "src", "app", "(app)", "masterdata");
const AREAS = ["products", "formulas", "routings", "work-instructions"];

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const all = AREAS.flatMap((a) => files(join(ROOT, a)));
const pages = all.filter((p) => p.endsWith("page.tsx"));
const rel = (p: string) => p.slice(ROOT.length);

describe("grade-5 recipe advanced-editing screens", () => {
  it("covers the 14 screens listed in PAGE_REVIEW.md", () => {
    expect(pages.length).toBe(14);
  });

  it.each(pages.map((p) => [rel(p)]))("%s says what the screen is for (PageIntro)", (r) => {
    const src = readFileSync(join(ROOT, r), "utf8");
    expect(src).toMatch(/<PageIntro>\s*This screen is for/);
  });

  it("never asks the user to type a code: code fields are optional and folded under More details", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      // No required code input, no visible "Code" / "SKU code" / "Formula code" / "Routing code" label.
      expect(src, p).not.toMatch(/name="code"[^>]*\srequired/);
      expect(src, p).not.toMatch(/label="(Code|SKU code|Formula code|Routing code|Instruction code)"/);
      if (/name="code"/.test(src)) {
        const at = src.indexOf('name="code"');
        expect(src.lastIndexOf("<MoreDetails", at), `${p}: the code field sits under More details`).toBeGreaterThan(-1);
        expect(src.slice(at - 200, at + 400), p).toMatch(/optional|The system gives one/);
      }
    }
  });

  it("the recipe and steps screens point to New recipe (step by step) first", () => {
    for (const r of ["/formulas/page.tsx", "/formulas/new/page.tsx", "/routings/page.tsx", "/routings/new/page.tsx"]) {
      const src = readFileSync(join(ROOT, r), "utf8");
      expect(src, r).toContain("Most people use New recipe (step by step). These screens are for advanced changes.");
      expect(src, r).toMatch(/<NextStep[^>]*href: "\/masterdata\/recipes\/new"/);
    }
  });

  it("version pages have a next step for draft, waiting and approved (send for approval, waiting for <name>, make a new version)", () => {
    for (const r of ["/formulas/[id]/revisions/[revisionId]/page.tsx", "/routings/[id]/revisions/[revisionId]/page.tsx"]) {
      const src = readFileSync(join(ROOT, r), "utf8");
      expect(src, r).toContain('label: "Send for approval"');
      expect(src, r).toContain("waitingForApprover(");
      expect(src, r).toContain('"Make a new version (step by step)"');
      // QA independence stays: the approval panel and the service's decision rules are unchanged.
      expect(src, r).toContain("<ApprovalPanel");
    }
  });

  it("the advanced recipe page shows packaging apart from the gram total", () => {
    const src = readFileSync(join(ROOT, "formulas/[id]/revisions/[revisionId]/page.tsx"), "utf8");
    expect(src).toContain("Packaging per batch");
    expect(src).toContain("v.totals.packaging");
    const editor = readFileSync(join(ROOT, "formulas/[id]/revisions/[revisionId]/line-editor.tsx"), "utf8");
    expect(editor).toMatch(/isPack\(r\) \? acc/);
  });

  it("the product screens link to the step-by-step recipe", () => {
    const src = readFileSync(join(ROOT, "products/[id]/page.tsx"), "utf8");
    expect(src).toContain('"Open the recipe"');
    expect(src).toContain('"Make a recipe (step by step)"');
  });

  it("shows grade-5 words instead of the old jargon in titles and labels", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/title=\{?["`](Formulas|Routings|Work instructions|SKU details|Revisions)["`]/);
      expect(src, p).not.toMatch(/label="(Theoretical yield \(%\)|Reference batch size \(g\)|Proposed effective date|Tolerance|Change summary|Quantity \(g\))"/);
      expect(src, p).not.toMatch(/>\s*(Start new revision|Submit for approval|Withdraw to draft|Retire revision)\s*</);
    }
  });

  it("phone: lists use PlainList rows, not wide tables", () => {
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/<Table\s/);
    }
  });
});

describe("shelf life in months (A-RW-01)", () => {
  it("months → days and back for whole months only", () => {
    expect(monthsToDays(24)).toBe(730);
    expect(monthsToDays(6)).toBe(183);
    expect(daysToWholeMonths(730)).toBe(24);
    expect(daysToWholeMonths(183)).toBe(6);
    expect(daysToWholeMonths(540)).toBeNull();
    expect(daysToWholeMonths(null)).toBeNull();
  });
});
