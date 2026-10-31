import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterOptions, searchWords } from "@/app/(app)/sales/name-picker";

/**
 * Grade-5 standard (ADR-088, docs/PAGE_REVIEW.md "Sales & customers") for the 25 sales screens: every screen
 * says what it is for, record pages say what to do next, no form asks the user to type a code (customer,
 * price list and label design codes come from the server), customers and products are picked by name, and the
 * old jargon (SKU, allocate, pick, dispatch, POD, RMA, credit hold, price list) is not shown as a heading or button.
 */
const ROOT = join(__dirname, "..", "..", "src", "app", "(app)", "sales");

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const all = files(ROOT);
const pages = all.filter((p) => p.endsWith("page.tsx"));
const rel = (p: string) => p.slice(ROOT.length);
const RECORD_PAGES = ["/[orderId]/page.tsx", "/customers/[id]/page.tsx", "/picking/[pickId]/page.tsx", "/packing/[shipmentId]/page.tsx", "/price-lists/[id]/page.tsx", "/quotations/[id]/page.tsx", "/returns/[returnId]/page.tsx", "/shipments/[shipmentId]/page.tsx"];

describe("grade-5 sales screens", () => {
  it("covers the 25 screens listed in PAGE_REVIEW.md", () => {
    expect(pages.length).toBe(25);
  });

  it.each(pages.map((p) => [rel(p)]))("%s says what the screen is for (PageIntro)", (r) => {
    const src = readFileSync(join(ROOT, r), "utf8");
    expect(src).toMatch(/<PageIntro>\s*This screen is for/);
  });

  it.each(RECORD_PAGES.map((p) => [p]))("record page %s shows what to do next (NextStep / DoNext)", (r) => {
    const src = readFileSync(join(ROOT, r), "utf8");
    expect(src).toMatch(/<(NextStep|DoNext)\b/);
  });

  it("names who we are waiting for on records that wait for someone else", () => {
    for (const r of ["/[orderId]/page.tsx", "/quotations/[id]/page.tsx", "/price-lists/[id]/page.tsx", "/packing/[shipmentId]/page.tsx", "/shipments/[shipmentId]/page.tsx", "/returns/[returnId]/page.tsx"]) {
      expect(readFileSync(join(ROOT, r), "utf8"), r).toMatch(/whoDoes\(ctx, "/);
    }
  });

  it("never asks the user to type a code (customer number, price list number, label design code)", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      // A required "code" input is allowed only as a scan box (the label is scanned, not typed).
      for (const m of src.matchAll(/name="(code|artworkCode|versionLabel)"[^>]*\brequired\b/g)) expect(src.slice(Math.max(0, m.index - 300), m.index), p).toMatch(/label="Scan/);
      expect(src, p).not.toMatch(/bind\("code"\)\}[^>]*\brequired\b/);
    }
  });

  it("the new-customer form shows only name, phone and address; the rest is under More details", () => {
    const src = readFileSync(join(ROOT, "customers", "new", "customer-form.tsx"), "utf8");
    const before = src.slice(0, src.indexOf("<MoreDetails"));
    const visible = [...before.matchAll(/<Field label="([^"]+)"/g)].map((m) => m[1]);
    expect(visible).toEqual(["Customer name", "Phone", "Street address", "City or town"]);
    const after = src.slice(src.indexOf("<MoreDetails"));
    for (const f of ["Contact person (optional)", "Days to pay (optional)", "Customer number (optional)"]) expect(after).toContain(f);
  });

  it("customers and products are picked by name with search on the order, price offer and price forms", () => {
    for (const f of [join("new", "order-form.tsx"), join("quotations", "quote-form.tsx"), join("price-lists", "price-list-form.tsx")]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).toContain("<NamePicker");
      expect(src, f).not.toMatch(/\{c\.name\} \(\{c\.code\}\)/);
      expect(src, f).not.toMatch(/\{p\.skuCode\} · \{p\.name\}/);
    }
  });

  it("shows grade-5 words instead of the old jargon in titles and buttons", () => {
    const jargon = /(title|label|submit)="[^"]*\b(SKU|Allocate[ds]?|Pick list|Start pick|Complete pick|Dispatch|POD|RMA|Credit hold|Price lists?|Quotations?|Pack verification|Fulfilment)\b[^"]*"/;
    for (const p of all) expect(readFileSync(p, "utf8"), p).not.toMatch(jargon);
  });

  it("keeps the controls: approvals, checker ≠ picker, exception approval, immutability notes", () => {
    const order = readFileSync(join(ROOT, "[orderId]", "page.tsx"), "utf8");
    expect(order).toContain("approval?.canApprove");
    expect(order).toContain("<ApproveOrderForm");
    const packing = readFileSync(join(ROOT, "packing", "[shipmentId]", "page.tsx"), "utf8");
    expect(packing).toContain("v.isPicker");
    expect(packing).toContain("approveExceptionAction");
    expect(packing).toContain('name="password"');
    const customer = readFileSync(join(ROOT, "customers", "[id]", "page.tsx"), "utf8");
    expect(customer).toContain("sodConflictAt"); // ADR-091: the owner may approve own customer rules
    const shipment = readFileSync(join(ROOT, "shipments", "[shipmentId]", "page.tsx"), "utf8");
    expect(shipment).toContain('confirm="Stock leaves the shelf now.');
  });
});

describe("NamePicker search", () => {
  const opts = [
    { value: "1", label: "Acapulco Soap 135 g", also: "ACS-135" },
    { value: "2", label: "Mabuhay Pharmacy Group", also: "CUS-0002" },
    { value: "3", label: "Isla Spa Supplies", also: "CUS-0003" },
  ];
  it("splits the search into lower-case words", () => {
    expect(searchWords("  Acap  SOAP ")).toEqual(["acap", "soap"]);
  });
  it("matches every word against the name (and the hidden code), keeping the chosen one", () => {
    expect(filterOptions(opts, "soap acap").map((o) => o.value)).toEqual(["1"]);
    expect(filterOptions(opts, "cus-0003").map((o) => o.value)).toEqual(["3"]);
    expect(filterOptions(opts, "spa", "2").map((o) => o.value)).toEqual(["2", "3"]);
    expect(filterOptions(opts, "").length).toBe(3);
    expect(filterOptions(opts, "zzz")).toEqual([]);
  });
});
