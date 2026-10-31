import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Grade-5 standard (ADR-088, docs/PAGE_REVIEW.md) for the Quality and Maintenance screens:
 * every screen says what it is for, no form asks the user to type a record number (the system numbers
 * QA records, repair jobs and regular maintenance), and the old jargon is not shown as a heading.
 */
const ROOT = join(__dirname, "..", "..", "src", "app", "(app)");

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const all = [...files(join(ROOT, "quality")), ...files(join(ROOT, "maintenance"))];
const pages = all.filter((p) => p.endsWith("page.tsx"));

describe("grade-5 quality and maintenance screens", () => {
  it("covers the 38 screens listed in PAGE_REVIEW.md", () => {
    expect(pages.length).toBe(38);
  });

  it.each(pages.map((p) => [p.slice(ROOT.length)]))("%s says what the screen is for (PageIntro)", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    expect(src).toMatch(/<PageIntro>\s*This screen is for/);
  });

  it("never asks the user to type a record number (numbers come from the server)", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/name="(inspectionNumber|deviationNumber|holdNumber|capaNumber|changeNumber|complaintNumber|recallNumber|planNumber|workOrderNumber|code)"\s[^>]*required/);
    }
  });

  it("shows grade-5 words instead of the old jargon in titles", () => {
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/title="(Deviations|CAPA|Change control|Recall cases|Recall explorer|Traceability|Inspections|QA holds|Bulk disposition|PM plans|Maintenance work orders)"/);
    }
  });
});
