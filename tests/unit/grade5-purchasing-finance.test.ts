import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Grade-5 standard (ADR-088, docs/PAGE_REVIEW.md) for the Purchasing and Finance screens: every screen says what
 * it is for, record lists use the name-first phone list (no wide tables), nobody types a record number, and the
 * old accounting words are not shown as titles or button labels.
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

const all = [...files(join(ROOT, "procurement")), ...files(join(ROOT, "finance"))];
const pages = all.filter((p) => p.endsWith("page.tsx"));
const isRedirect = (src: string) => /redirect\(/.test(src) && !/<PageHeader/.test(src);

describe("grade-5 purchasing and finance screens", () => {
  it("covers the 36 screens listed in PAGE_REVIEW.md (17 purchasing + 19 finance)", () => {
    expect(pages.length).toBe(36);
  });

  it.each(pages.map((p) => [p.slice(ROOT.length)]))("%s says what the screen is for (PageIntro)", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (isRedirect(src)) return; // /procurement/expected/[poId] only forwards to Receive
    expect(src).toMatch(/<PageIntro>\s*This screen is for/);
  });

  it("uses phone lists instead of wide tables on every screen", () => {
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/<Table\b/);
      expect(src, p).not.toMatch(/ResponsiveList/);
    }
  });

  it("never asks the user to type a record number or a code", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/name="(poNumber|requestNumber|returnNumber|invoiceNumber|billNumber|paymentNumber|claimNumber|creditNoteNumber)"/);
      // The tax code is picked from a list (or made from the name), never a required text box.
      expect(src, p).not.toMatch(/name="code"\s+required/);
    }
  });

  it("shows grade-5 words instead of the old jargon in titles and buttons", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/title="(Purchase requests|Procurement|Expected receipts|Supplier returns|Reorder suggestions|Supplier performance|Forecast assumptions|Accounting periods|Credit notes|Tax configuration|Finance)"/);
      expect(src, p).not.toMatch(/label="(Post bill|Issue invoice|Issue and apply|Record payment|Post claim|Void [^"]*|Lock period|Request unlock|Approve the variance|Submit \(run the match\))"/);
      expect(src, p).not.toMatch(/>\s*(Short-close|Export CSV|Three-way match)\s*</);
    }
  });

  it("keeps the money controls: password re-entry on saving to the books and cancelling (kept on record)", () => {
    const rec = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
    for (const [rel, cmds] of [
      ["finance/invoices/[id]/page.tsx", ["issue", "void"]],
      ["finance/bills/[id]/page.tsx", ["post", "void"]],
      ["finance/credit-notes/[id]/page.tsx", ["issue", "void"]],
      ["finance/payments/[id]/page.tsx", ["record", "void"]],
      ["finance/expenses/[id]/page.tsx", ["post", "void"]],
    ] as const) {
      const src = rec(rel);
      for (const c of cmds) expect(src, `${rel} ${c}`).toMatch(new RegExp(`command="${c}"[^>]*\\bpassword\\b`));
    }
  });
});
