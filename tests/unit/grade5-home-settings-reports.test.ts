import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_FILES, ROLE_GUIDES, listTaskGuides, loadGuide } from "@/ui/help/guides";
import { permissionSummary } from "@/ui/permission-words";
import { homeIntro, plainRole, plainRoleName } from "@/ui/role-names";
import { codeFromName } from "@/ui/name-and-code";

/**
 * Grade-5 standard (ADR-088, docs/PAGE_REVIEW.md) for Home, Settings & people, Reports, Help and
 * Operations: every screen says what it is for, no form asks the user to type a code, role names and
 * permission strings are shown in plain words, and /help has the five role guides.
 */
const APP = join(__dirname, "..", "..", "src", "app");
const ROOT = join(APP, "(app)");

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const AREAS = ["account", "action-centre", "approvals", "dashboard", "notifications", "sync", "admin", "documents", "management", "analytics", "reports", "help", "operations"];
const all = AREAS.flatMap((a) => files(join(ROOT, a)));
// /admin only redirects to /admin/users.
const pages = all.filter((p) => p.endsWith("page.tsx") && !p.endsWith(join("admin", "page.tsx")));

describe("grade-5 home, settings, reports, help and operations screens", () => {
  it("covers the screens listed in PAGE_REVIEW.md (Home 10, Settings & people 28 + redirect, Reports 12, Help 1, Operations 1)", () => {
    expect(pages.length).toBe(52);
  });

  it.each(pages.map((p) => [p.slice(ROOT.length)]))("%s says what the screen is for (PageIntro)", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    expect(src).toMatch(/<PageIntro>/);
    expect(src).toMatch(/This screen is for|homeIntro\(|PLAIN_AREA\[/);
  });

  it("the floor TV says what it is for", () => {
    expect(readFileSync(join(APP, "floor", "page.tsx"), "utf8")).toMatch(/This screen is for everyone on the floor/);
  });

  it("never asks the user to type a code: every code field is made from the name", () => {
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      // A visible, required, typed `code` input is not allowed; NameAndCode / generated values only.
      expect(src, p).not.toMatch(/<Input id="code" name="code" required(?![^>]*value=\{)[^>]*\/>/);
      expect(src, p).not.toMatch(/name="mappingCode" placeholder/);
    }
  });

  it("does not show KPI codes or the old jargon as page titles", () => {
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/title="(Audit log|KPI definitions|Report library|Scheduled reports|Trends|Numbering rules|Approval rules|Notification rules|Sync conflicts|Sessions|Diagnostics|Devices|Users)"/);
      expect(src, p).not.toMatch(/subtitle=\{`\$\{r\.def\.code\}/);
    }
  });

  it("role names are said the way people say them", () => {
    expect(plainRole("owner_director")).toBe("Owner");
    expect(plainRole("site_manager")).toBe("Site manager");
    expect(plainRole("production_operator")).toBe("Machine operator");
    expect(plainRole("warehouse_operator")).toBe("Warehouse");
    expect(plainRole("qa_qc")).toBe("QA");
    expect(plainRole("sales_cs")).toBe("Sales");
    expect(plainRole("finance")).toBe("Finance");
    expect(plainRoleName("Owner/Director")).toBe("Owner");
    expect(plainRoleName("My custom role")).toBe("My custom role");
    expect(homeIntro(["production_operator"])).toMatch(/^This screen is for the machine operator/);
  });

  it("permission strings become plain sentences", () => {
    const s = permissionSummary(["inventory.lot.view", "inventory.adjustment.approve", "inventory.movement.post", "quality.disposition.approve"]);
    expect(s.find((r) => r.module === "inventory")).toMatchObject({ label: "Stock", actions: ["see", "approve", "save for good"] });
    expect(s.find((r) => r.module === "quality")?.label).toBe("Quality (QA)");
  });

  it("codes are made from names", () => {
    expect(codeFromName("Warehouse label desk")).toBe("WAREHOUSE-LABEL-DESK");
    expect(codeFromName("Raw material label", "LBL-", 30)).toBe("LBL-RAW-MATERIAL-LABEL");
    expect(codeFromName("  ", "TPL-")).toBe("TPL");
  });

  it("help has five role guides, each 'Your day in 5 steps', plus 'Words we use'", () => {
    expect(ROLE_GUIDES.map((r) => r.label)).toEqual(["Owner", "Site manager", "Machine operator", "Warehouse", "QA"]);
    for (const r of ROLE_GUIDES) {
      const g = loadGuide(r.key);
      expect(g, r.key).not.toBeNull();
      expect(g!.blocks.some((b) => b.kind === "h" && b.text === "Your day in 5 steps")).toBe(true);
      const steps = g!.blocks.find((b) => b.kind === "ol");
      expect(steps && steps.kind === "ol" ? steps.items.length : 0, r.key).toBe(5);
    }
    const words = loadGuide("start.words");
    for (const w of ["Lot", "Batch", "Quality check", "Batch record (BMR)", "INCI", "Version"]) expect(JSON.stringify(words!.blocks)).toContain(`**${w}**`);
  });

  it("task guides linked from screens still exist (the ? button and /help#key)", () => {
    const keys = listTaskGuides().map((g) => g.key);
    expect(keys).toContain("start.getting_started");
    expect(keys).toContain("analytics.reports");
    expect(Object.keys(GUIDE_FILES).length).toBe(keys.length + ROLE_GUIDES.length + 1);
  });
});
