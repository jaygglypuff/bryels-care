/**
 * ADR-132 §10 (completing ADR-125 item 5): no form makes its idempotency key during render (the server HTML and the
 * browser's first render would differ: a hydration mismatch). Keys come from `useClientKey` / `useRenewableClientKey`
 * after hydration, and the server actions accept a form sent before that (`formKey` gives it its own key; a key that
 * is there is kept, so a retry still replays).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formKey } from "@/lib/form-key";

const src = path.resolve(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });

describe("form keys", () => {
  it("formKey keeps a sent key and makes one when the form had none", () => {
    const fd = new FormData();
    fd.set("idempotencyKey", "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b");
    expect(formKey(fd)).toBe("6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b");
    const empty = new FormData();
    empty.set("idempotencyKey", "");
    const a = formKey(empty);
    const b = formKey(new FormData());
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
    const junk = new FormData();
    junk.set("idempotencyKey", "not-a-key");
    expect(formKey(junk)).not.toBe("not-a-key");
  });

  it("no client component makes a random key while rendering", () => {
    const bad = files(src).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /useState\(\s*\(\)\s*=>\s*\(?\s*(typeof crypto[^)]*\?\s*)?crypto\.randomUUID\(\)/.test(s) || /useState\(newKey\)/.test(s);
    });
    // The work-order form of the old screen (/production/work-orders redirects) is left as it was.
    expect(bad.map((f) => path.relative(src, f)).filter((f) => !f.endsWith("production/work-orders/wo-form.tsx"))).toEqual([]);
  });

  it("the forms named in ADR-125 render their key only once it exists", () => {
    for (const f of ["app/(app)/quality/holds/forms.tsx", "app/(app)/admin/templates/forms.tsx", "app/(app)/inventory/receive/put-away/put-away-form.tsx", "app/(app)/production/[batchId]/closure/forms.tsx", "app/(app)/documents/forms.tsx", "app/print/bmr/[batchId]/generate-form.tsx"]) {
      const s = readFileSync(path.join(src, f), "utf8");
      expect(s, f).toMatch(/useClientKey|useRenewableClientKey/);
      expect(s, f).toContain('{key && <input type="hidden" name="idempotencyKey" value={key} />}');
    }
  });
});
