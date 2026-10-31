import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCATION_KIND_WORDS, LOT_STATUS_WORDS, MOVEMENT_LABEL, fmtLotQty, placeWords } from "@/ui/inventory/words";

/**
 * Grade-5 standard (ADR-088, docs/PAGE_REVIEW.md) for the Inventory & warehouse screens (/inventory/**,
 * /labels/**, /warehouse/**): every screen says what it is for, nobody types a code, stock changes and
 * places are named in plain words, wide ledger tables are gone, and amounts read in friendly units.
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

const all = [...files(join(ROOT, "inventory")), ...files(join(ROOT, "labels")), ...files(join(ROOT, "warehouse"))];
const pages = all.filter((p) => p.endsWith("page.tsx"));
/** Pages that only redirect (an old address kept working) have nothing to explain. */
const isRedirect = (src: string) => /redirect\(/.test(src) && !/<PageHeader/.test(src);

describe("grade-5 inventory and warehouse screens", () => {
  it("covers the 38 screens listed in PAGE_REVIEW.md", () => {
    expect(pages.length).toBe(38);
  });

  it.each(pages.map((p) => [p.slice(ROOT.length)]))("%s says what the screen is for (PageIntro)", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (isRedirect(src)) return;
    expect(src).toMatch(/<PageIntro>\s*This screen is for/);
  });

  it("never asks the user to type a code (lots by scan or words, numbers from the server)", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      // No placeholder teaching a code format to type (BC:LOT:…, L-2610-…, BX-…, BC:LOC:…).
      expect(src, p).not.toMatch(/placeholder=\{?["'`](BC:|L-\d{4}|BX-\d|.*or type the lot number)/);
      expect(src, p).not.toMatch(/type the lot number|type its number/i);
      // Record numbers are never a required typed field.
      expect(src, p).not.toMatch(/name="(adjustmentNumber|countNumber|containerNumber|receiptNumber|reservationNumber|code)"\s[^>]*required/);
    }
  });

  it("does not show the old jargon as titles", () => {
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/title="(Stock movements|Stock movement|Stock card|Goods receipts|Locations & stock|Boxes|Work in progress|Expiry alerts|Stock availability|FEFO recommendation & reservations|Label print station)"/);
      expect(src, p).not.toMatch(/(Reverse this movement|Post reversal|Post move|Correction rows|Allocate \/ ship|Issue to production)/);
    }
  });

  it("lists stock changes as rows, not the eight-column ledger table", () => {
    for (const rel of ["inventory/movements/page.tsx", "inventory/[lotId]/page.tsx", "inventory/stock-card/[lotId]/page.tsx", "inventory/movements/[id]/page.tsx", "inventory/containers/page.tsx", "inventory/locations/page.tsx", "inventory/adjustments/page.tsx", "inventory/counts/page.tsx", "inventory/receipts/page.tsx", "inventory/wip/page.tsx"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/<Table\s/);
    }
  });

  it("record pages show one next step (NextStep) and keep rare actions in ⋯ More", () => {
    for (const rel of ["inventory/[lotId]/page.tsx", "inventory/movements/[id]/page.tsx", "inventory/adjustments/[id]/page.tsx", "inventory/counts/[id]/page.tsx", "inventory/containers/[id]/page.tsx", "labels/jobs/[jobId]/page.tsx", "warehouse/packs/[packId]/page.tsx"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, rel).toMatch(/<NextStep/);
      expect(src, rel).toMatch(/<MoreMenu/);
    }
  });

  it("keeps every control: undo with reason and typed word, count freeze, two OKs, self-approval refused", () => {
    const reverse = readFileSync(join(ROOT, "inventory/movements/[id]/reverse-form.tsx"), "utf8");
    expect(reverse).toMatch(/name="reason"[^>]*required/);
    expect(reverse).toMatch(/REVERSE/);
    const count = readFileSync(join(ROOT, "inventory/counts/[id]/page.tsx"), "utf8");
    expect(count).toMatch(/Shelves locked/);
    expect(count).toMatch(/did not count/);
    const adj = readFileSync(join(ROOT, "inventory/adjustments/[id]/page.tsx"), "utf8");
    expect(adj).toMatch(/not the person who made it/);
    expect(adj).toMatch(/second OK/);
  });
});

describe("plain words and friendly units (ADR-088, ADR-090)", () => {
  it("names stock change types in plain words", () => {
    expect(MOVEMENT_LABEL.transfer).toBe("Moved");
    expect(MOVEMENT_LABEL.consumption).toBe("Used in making");
    expect(MOVEMENT_LABEL.reversal).toBe("Undo (kept on record)");
    expect(MOVEMENT_LABEL.issue).not.toMatch(/issue/i);
    for (const v of Object.values(MOVEMENT_LABEL)) expect(v).not.toMatch(/reversal|consumption|transfer|posting/i);
  });

  it("names lot states and places without quarantine jargon", () => {
    expect(LOT_STATUS_WORDS.quarantine).toBe("Waiting for QA check");
    expect(LOT_STATUS_WORDS.on_hold).toBe("Stopped by QA");
    expect(LOCATION_KIND_WORDS.quarantine).toBe("Waiting for QA check");
    expect(LOCATION_KIND_WORDS.storage).toBe("Shelf");
  });

  it("shows amounts in kg / L without trailing zeros", () => {
    expect(fmtLotQty("25000", "g")).toBe("25 kg");
    expect(fmtLotQty("12500", "g")).toBe("12.5 kg");
    expect(fmtLotQty("250", "g")).toBe("250 g");
    expect(fmtLotQty("0", "g")).toBe("0 kg");
    expect(fmtLotQty("1500", "mL")).toBe("1.5 L");
    expect(fmtLotQty("4800", "pcs")).toBe("4,800 pcs");
    expect(fmtLotQty("-1500", "g")).toBe("-1.5 kg");
  });

  it("says where stock went in words", () => {
    expect(placeWords("Oils rack A-01", "Finished goods bay")).toBe("from Oils rack A-01 to Finished goods bay");
    expect(placeWords(null, "Quarantine cage")).toBe("into Quarantine cage");
    expect(placeWords("Dispatch bay", null)).toBe("out of Dispatch bay");
  });
});
