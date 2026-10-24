/**
 * In-place action rules (ADR-043, docs/ux-system.md "Rules: 5.8a In-place actions").
 *
 * A server action that keeps the user on the page re-renders that page in its own response
 * (refreshCurrentPage). React only commits that response reliably when no Suspense boundary that
 * is already showing content wraps the page, so route `loading.tsx` files and `<Suspense>` are not
 * allowed in the app, and forms do not refresh the router themselves (except the cases below).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const appFiles = walk(path.join(ROOT, "src/app"));
const sourceFiles = [...appFiles, ...walk(path.join(ROOT, "src/ui"))].filter((f) => /\.(tsx?|jsx?)$/.test(f));

/**
 * `router.refresh()` is allowed only where no server-action response exists to carry the page:
 * uploads through the REST API, and the MFA recovery codes, which stay on screen until the user
 * confirms they saved them.
 */
const REFRESH_ALLOWED = new Set([
  "src/app/(app)/inventory/receive/[grId]/forms.tsx",
  "src/app/(app)/production/[batchId]/closure/forms.tsx",
  "src/app/(app)/account/forms.tsx",
  "src/app/(app)/admin/imports/forms.tsx",
]);

describe("in-place actions (ADR-043)", () => {
  it("no route loading.tsx anywhere in the app", () => {
    const loading = appFiles.filter((f) => /^loading\.(tsx|ts|jsx|js)$/.test(path.basename(f))).map(rel);
    expect(loading).toEqual([]);
  });

  it("no <Suspense> boundaries in pages, layouts or shared components", () => {
    const offenders = sourceFiles.filter((f) => /\bSuspense\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("forms do not refresh the router themselves (the action response carries the page)", () => {
    const offenders = sourceFiles.filter((f) => /\brouter\.refresh\(/.test(readFileSync(f, "utf8")) && !REFRESH_ALLOWED.has(rel(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no form control is named after a form method (React calls form.reset() after an action)", () => {
    const offenders = sourceFiles.filter((f) => /\bname=["'](reset|submit|requestSubmit)["']/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the W2A and W2C in-place actions refresh the current page on the server", () => {
    for (const f of ["src/app/(app)/quality/w2c-actions.ts", "src/app/(app)/production/work-orders/actions.ts"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).toContain('import { refreshCurrentPage } from "@/lib/in-place";');
      expect(src, f).not.toMatch(/the client refreshes|forms refresh the router/);
    }
  });

  it("refreshCurrentPage marks the whole tree stale so the response re-renders the current page", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/in-place.ts"), "utf8");
    expect(src).toContain('revalidatePath("/", "layout")');
  });
});
