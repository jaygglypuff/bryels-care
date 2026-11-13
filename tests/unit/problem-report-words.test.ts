/**
 * ADR-132 §9 (round 5 C report B19): a problem report speaks plain words — "Small / Big / Very serious", never
 * minor/major/critical; "deviation" never reaches the screen; a lot QA already stopped is not "nothing stopped".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { severityWords } from "@/lib/severity-words";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("problem report words", () => {
  it("severity levels read Small / Big / Very serious; a level the company adds is spaced out", () => {
    expect(["minor", "major", "critical"].map(severityWords)).toEqual(["Small", "Big", "Very serious"]);
    expect(severityWords("needs_lab")).toBe("Needs lab");
    expect(severityWords(null)).toBe("");
  });

  it("no message of the problem-report service says 'deviation'", () => {
    const src = read("src/modules/quality/deviations.ts");
    const messages = [...src.matchAll(/new DomainError\(\s*"[a-z_]+",\s*(`[^`]*`|"[^"]*")/g), ...src.matchAll(/assertSeparation\([^,]+,\s*(`[^`]*`|"[^"]*")/g), ...src.matchAll(/closeBlockedReason[\s\S]{0,600}?\?\s*("[^"]*"|`[^`]*`)/g)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThan(8);
    for (const m of messages) expect(m, m).not.toMatch(/\bdeviation\b|containment|severity|classify/i);
  });

  it("the pages and forms show the words, not the stored level", () => {
    for (const p of ["src/app/(app)/quality/deviations/[deviationId]/page.tsx", "src/app/(app)/quality/deviations/page.tsx", "src/app/(app)/quality/w2c-forms.tsx", "src/app/(app)/quality/complaints/forms.tsx", "src/app/(app)/quality/complaints/page.tsx", "src/app/(app)/quality/complaints/[complaintId]/page.tsx"]) {
      expect(read(p), p).toContain("severityWords(");
    }
  });

  it("a lot already stopped by QA says so", () => {
    expect(read("src/app/(app)/quality/deviations/[deviationId]/page.tsx")).toContain("This lot is already stopped by QA.");
  });
});
