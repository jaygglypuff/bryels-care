/**
 * ADR-132 §6 (round 5 C report B23): after a save the record opens at the top with its success message in view. The
 * frame scrolls up only when the URL says "just saved" and has no #anchor (back/forward and anchors are left alone).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAVED_PARAMS, landAtTop, savedLanding } from "@/ui/saved-landing";

const appDir = path.resolve(__dirname, "../../src/app");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });

describe("saved landing", () => {
  it("scrolls up after a save, not on an anchor or an ordinary visit", () => {
    expect(savedLanding("created=1", "")).toBe(true);
    expect(savedLanding("tab=lines&saved=1", "")).toBe(true);
    expect(savedLanding("created=1", "#lines")).toBe(false);
    expect(savedLanding("tab=lines", "")).toBe(false);
    expect(savedLanding("", "")).toBe(false);
  });

  it("a new page starts at the top unless reached with Back/Forward or an anchor; filters on one page do not move it", () => {
    const a = { path: "/procurement/requests/new", search: "" };
    expect(landAtTop(a, { path: "/procurement/requests/r1", search: "", hash: "" }, false)).toBe(true);
    expect(landAtTop(a, { path: "/procurement/requests/r1", search: "", hash: "" }, true)).toBe(false);
    expect(landAtTop(a, { path: "/procurement/requests/r1", search: "", hash: "#lines" }, false)).toBe(false);
    expect(landAtTop({ path: "/sales", search: "status=open" }, { path: "/sales", search: "status=all", hash: "" }, false)).toBe(false);
    expect(landAtTop({ path: "/sales/c1", search: "" }, { path: "/sales/c1", search: "saved=1", hash: "" }, false)).toBe(true);
    expect(landAtTop(null, { path: "/sales", search: "", hash: "" }, false)).toBe(false);
  });

  it("knows every 'just saved' word the server actions redirect with", () => {
    const used = new Set<string>();
    for (const f of files(appDir)) for (const m of readFileSync(f, "utf8").matchAll(/redirect\(`[^`]*\?([a-z]+)=/g)) used.add(m[1]);
    const ignore = new Set(["auto", "doc", "lot", "po"]); // not a save: a choice in the URL
    for (const p of used) if (!ignore.has(p)) expect(SAVED_PARAMS as readonly string[], p).toContain(p);
  });

  it("the frame mounts it", () => {
    expect(readFileSync(path.join(appDir, "(app)/shell.tsx"), "utf8")).toContain("<SavedLanding />");
  });
});
