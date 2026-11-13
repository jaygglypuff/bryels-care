/**
 * ADR-132 §6 (round 5 C report B23): after a save the record opens at the top with its success message in view. The
 * frame scrolls up only when the URL says "just saved" and has no #anchor (back/forward and anchors are left alone).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAVED_PARAMS, savedLanding } from "@/ui/saved-landing";

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
