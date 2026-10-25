/**
 * US-2-27: help.guide_versioned — the receive, move and count guides exist, carry a version and
 * an updated date, and parse into headings and steps; unknown screens have no guide (empty state).
 */
import { describe, expect, it } from "vitest";
import { GUIDE_FILES, listGuides, loadGuide, parseGuide } from "@/ui/help/guides";

describe("quick guides", () => {
  it("help.guide_versioned: every registered screen has a versioned guide", () => {
    for (const key of Object.keys(GUIDE_FILES)) {
      const g = loadGuide(key);
      expect(g, key).not.toBeNull();
      expect(g!.key).toBe(key);
      expect(g!.version).toBeGreaterThanOrEqual(1);
      expect(g!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g!.blocks.some((b) => b.kind === "h")).toBe(true);
    }
    expect(listGuides().map((g) => g.key).sort()).toEqual(Object.keys(GUIDE_FILES).sort());
  });

  it("US-9-08: a quick guide exists for every major flow and names its SOP mapping", () => {
    const flows = ["inventory.receive", "inventory.putaway", "inventory.move", "inventory.count", "production.work_order", "production.staging", "production.weighing", "production.line_clearance", "quality.release", "production.bmr", "sales.order", "sales.fulfilment", "quality.complaint", "sales.return", "platform.import", "analytics.reports"];
    for (const k of flows) {
      const g = loadGuide(k);
      expect(g, k).not.toBeNull();
      expect(g!.sop, `${k} sop`).toMatch(/SOP/);
      expect(g!.blocks.filter((b) => b.kind === "ol").length, k).toBeGreaterThanOrEqual(1);
    }
  });

  it("parses headings, numbered and bulleted lists and paragraphs; no guide → null", () => {
    const g = parseGuide("---\nkey: x\ntitle: X\nversion: 3\nupdated_at: 2026-10-24\n---\nIntro text.\n\n## Step one\n\n1. First **bold**\n2. Second\n\n- Note\n", "x");
    expect(g).toMatchObject({ key: "x", title: "X", version: 3 });
    expect(g.blocks).toEqual([
      { kind: "p", text: "Intro text." },
      { kind: "h", text: "Step one", id: "step-one" },
      { kind: "ol", items: ["First **bold**", "Second"] },
      { kind: "ul", items: ["Note"] },
    ]);
    expect(loadGuide("inventory.unknown_screen")).toBeNull();
  });
});
