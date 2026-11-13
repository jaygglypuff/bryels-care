/**
 * ADR-132 §7 (round 5 B report bug B6): every page sets its browser-tab title, which reads "<page> · Bryel's Care"
 * (root layout template). The walk finds every `page.tsx` under src/app; each exports `metadata` with a title or a
 * `generateMetadata`, unless it only redirects (it never renders, so its tab title is the target page's).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(__dirname, "../../src/app");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return pages(p);
    return n === "page.tsx" ? [p] : [];
  });
}

const rel = (p: string) => path.relative(appDir, p);
/** Renders nothing of its own: the body calls redirect() and has no header. */
const onlyRedirects = (src: string) => /\bredirect\(/.test(src) && !/<(PageHeader|RecordHeader|EmptyState|Card|main|div|section)\b/.test(src);
const hasTitle = (src: string) => /export const metadata\b[^;]*\btitle\b/s.test(src) || /export (async )?function generateMetadata\b/.test(src);

describe("browser-tab titles", () => {
  const all = pages(appDir);

  it("finds the app's pages", () => {
    expect(all.length).toBeGreaterThan(250);
  });

  it("every page that renders sets its own title", () => {
    const missing = all.filter((p) => {
      const src = readFileSync(p, "utf8");
      return !onlyRedirects(src) && !hasTitle(src);
    });
    expect(missing.map(rel)).toEqual([]);
  });

  it("the pages from the audit have their own title", () => {
    for (const p of ["(app)/admin/users/page.tsx", "(app)/procurement/suppliers/[id]/page.tsx", "(app)/quality/deviations/page.tsx", "(app)/quality/deviations/new/page.tsx", "(app)/quality/deviations/[deviationId]/page.tsx"]) {
      expect(hasTitle(readFileSync(path.join(appDir, p), "utf8")), p).toBe(true);
    }
  });

  it("the tab reads '<page> · Bryel's Care'", () => {
    const root = readFileSync(path.join(appDir, "layout.tsx"), "utf8");
    expect(root).toContain(`template: "%s · Bryel's Care"`);
  });
});
