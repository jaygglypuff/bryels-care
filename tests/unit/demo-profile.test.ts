import { describe, expect, it } from "vitest";
import { DEMO_SEED_VERSION, demoAutoDecision, demoProfile, expectedSeedVersion, loadedDemo } from "@/lib/demo";

/** Demo profiles and the seed version that makes start-up reload a demo database (src/lib/demo.ts, src/db/demo.ts). */
describe("demoProfile", () => {
  it("defaults to lite, accepts lite and full in any case, refuses anything else", () => {
    expect(demoProfile({})).toEqual({ profile: "lite", error: null });
    expect(demoProfile({ DEMO_PROFILE: " FULL " })).toEqual({ profile: "full", error: null });
    expect(demoProfile({ DEMO_PROFILE: "lite" })).toEqual({ profile: "lite", error: null });
    expect(demoProfile({ DEMO_PROFILE: "big" }).error).toContain("lite or full");
  });
});

describe("loadedDemo", () => {
  it("reads profile and version from the marker; a marker without a profile is the full seed", () => {
    expect(loadedDemo({ fictional: true })).toEqual({ profile: "full", version: null });
    expect(loadedDemo(null)).toEqual({ profile: "full", version: null });
    expect(loadedDemo({ profile: "lite", seedVersion: "x" })).toEqual({ profile: "lite", version: "x" });
  });
  it("only the lite profile has a version", () => {
    expect(expectedSeedVersion("lite")).toBe(DEMO_SEED_VERSION);
    expect(expectedSeedVersion("full")).toBeNull();
  });
});

describe("demoAutoDecision", () => {
  const lite = { after: { fictional: true, profile: "lite", seedVersion: DEMO_SEED_VERSION } };
  it("loads an empty database", () => {
    expect(demoAutoDecision({ organizations: 0, marker: null, profile: "lite" }).action).toBe("load");
  });
  it("reloads an interrupted load (no marker)", () => {
    const d = demoAutoDecision({ organizations: 1, marker: null, profile: "lite" });
    expect(d).toMatchObject({ action: "reload" });
    expect(d.reason).toContain("interrupted demo load");
  });
  it("reloads the old full demo when the profile is lite (the live demo after this deploy)", () => {
    const d = demoAutoDecision({ organizations: 2, marker: { after: { fictional: true } }, profile: "lite" });
    expect(d.action).toBe("reload");
    expect(d.reason).toContain("full demo data");
  });
  it("reloads a lite demo of another version, and does nothing for the current one", () => {
    const old = demoAutoDecision({ organizations: 2, marker: { after: { profile: "lite", seedVersion: "2026-01-01.1" } }, profile: "lite" });
    expect(old.action).toBe("reload");
    expect(old.reason).toContain("New demo data version");
    expect(demoAutoDecision({ organizations: 2, marker: lite, profile: "lite" })).toMatchObject({ action: "nothing" });
  });
  it("full profile: the full seed is current, a lite demo is replaced", () => {
    expect(demoAutoDecision({ organizations: 2, marker: { after: { fictional: true } }, profile: "full" }).action).toBe("nothing");
    expect(demoAutoDecision({ organizations: 2, marker: lite, profile: "full" }).action).toBe("reload");
  });
});
