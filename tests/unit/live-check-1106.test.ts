/**
 * Live check of the small demo, 2026-11-06 (desktop Chrome and the role Homes): the pure helpers behind the fixes.
 * Names of the next people: tests/integration/governance/live-check-names.test.ts.
 */
import { describe, expect, it } from "vitest";
import { activitySentence } from "@/app/(app)/dashboard/activity-sentence";
import { firstActionable, floorQuickKeys, putAwaySentence, salesItems, type AttentionItem } from "@/app/(app)/dashboard/home-next";
import { doingPermission } from "@/app/(app)/forbidden-words";
import { DESKTOP_ROW_MAX, buildNav, desktopRow, groupSections } from "@/app/(app)/nav";
import { type NextActors, othersSentence } from "@/lib/next-actors-words";
import { PERMISSIONS, ROLE_BUNDLES, type Permission } from "@/lib/permissions";
import { fmtDayMonth } from "@/lib/qty";
import { FLOW_STAGES, withDueWords } from "@/modules/analytics/work-flow-stages";
import { salesOrderSteps, shortStepLabel } from "@/ui/record-steps";

const canFor = (role: string) => {
  const set = new Set<string>(ROLE_BUNDLES[role].permissions);
  return (p: string) => set.has(p);
};

describe("finding 1: refusals name the people who can DO it", () => {
  it("a .view permission is read as the entity's doing permission", () => {
    expect(doingPermission("quality.disposition.view", PERMISSIONS)).toBe("quality.disposition.approve");
    expect(doingPermission("procurement.goods_receipt.view", PERMISSIONS)).toBe("procurement.goods_receipt.create");
    expect(doingPermission("sales.sales_order.view", PERMISSIONS)).toBe("sales.sales_order.create");
    expect(doingPermission("quality.disposition.approve", PERMISSIONS)).toBe("quality.disposition.approve");
    expect(doingPermission("no.such.view", PERMISSIONS)).toBe("no.such.view");
  });

  const base: NextActors = { kind: "lot_qa", does: "checks this lot and says OK or not OK", doBase: "check this lot and say OK or not OK", where: "on Check quality", people: [{ userId: "t", name: "Teresa Ocampo", role: "QA" }], roleWords: "QA", viewer: { can: true, selfApproval: false, note: null }, stepNo: null, stepsTotal: null };
  it("when the viewer can act, the line still names who else can", () => {
    expect(othersSentence(base)).toBe("So can Teresa (QA).");
    expect(othersSentence({ ...base, people: [] })).toBeNull();
    expect(othersSentence({ ...base, viewer: { can: false, selfApproval: false, note: null } })).toBe("Next: Teresa (QA) checks this lot and says OK or not OK — they will see it on Check quality.");
  });
});

describe("finding 2: desktop tab row never wraps", () => {
  it("no role sees more than DESKTOP_ROW_MAX entries plus More, and nothing is lost", () => {
    for (const role of Object.keys(ROLE_BUNDLES)) {
      for (const g of buildNav(canFor(role) as (p: Permission) => boolean, [role])) {
        const { main: all, sections } = groupSections(g);
        const main = all.filter((i) => i.topBar !== "always" && i.topBar !== "wide");
        const row = desktopRow(main, sections);
        expect(row.pills.length + row.sections.length, `${role} ${g.label}`).toBeLessThanOrEqual(DESKTOP_ROW_MAX);
        const shown = [...row.pills, ...(row.more?.items ?? [])].map((i) => i.href).sort();
        expect(shown, `${role} ${g.label}`).toEqual(main.map((i) => i.href).sort());
        expect([...row.sections, ...(row.more?.sections ?? [])].map((s) => s.name)).toEqual(sections.map((s) => s.name));
      }
    }
  });

  it("the owner's Operations keeps the daily tabs and puts the TV screen and rejects under More", () => {
    const g = buildNav(canFor("owner_director") as (p: Permission) => boolean, ["owner_director"]).find((x) => x.label === "Operations")!;
    const { main, sections } = groupSections(g);
    const row = desktopRow(main, sections);
    expect(row.pills.map((i) => i.label)).toContain("Check a batch or delivery");
    expect(row.more?.items.map((i) => i.label)).toEqual(expect.arrayContaining(["Floor screen (TV)", "Rejects"]));
    expect(row.sections.map((s) => s.name)[0]).toBe("Receiving");
  });

  it("a short row is unchanged", () => {
    const row = desktopRow([{ label: "A", href: "/a" }], [{ name: "S", items: [{ label: "B", href: "/b", section: "S" }] }]);
    expect(row.more).toBeNull();
  });

  it("the customer order stepper has short words for its long steps", () => {
    expect(shortStepLabel("Second check of the box")).toBe("Second check");
    expect(shortStepLabel("Proof of delivery")).toBe("Proof");
    expect(shortStepLabel("Done")).toBe("Done");
    expect(salesOrderSteps("allocated").map((s) => s.label)).toContain("Done");
  });
});

describe("finding 4: role Homes give the viewer's own next step", () => {
  const items: AttentionItem[] = [
    { key: "qc", text: "1 finished batch waits for the QA check", href: "/quality" },
    ...salesItems({ toConfirm: 1, short: 2, canSetAside: 0 }),
  ];
  it("sales never gets QA's check as the next step", () => {
    expect(firstActionable(items, canFor("sales_cs"))?.key).toBe("so_confirm");
    expect(firstActionable(items, canFor("qa_qc"))?.key).toBe("qc");
    expect(firstActionable([items[0]], canFor("sales_cs"))).toBeNull();
    expect(firstActionable([{ key: "approve", text: "x", href: "/approvals" }], () => false)?.key).toBe("approve");
  });

  it("sales lines in words", () => {
    expect(salesItems({ toConfirm: 1, short: 2, canSetAside: 1 }).map((i) => i.text)).toEqual([
      "1 customer order waits to be confirmed",
      "2 customer orders are short of stock: ask the planner to make it",
      "1 customer order can now get its stock set aside",
    ]);
    expect(salesItems({ toConfirm: 0, short: 0, canSetAside: 0 })).toEqual([]);
  });

  it("the warehouse is told which lot to put away and where", () => {
    expect(putAwaySentence({ itemName: "Coconut Oil", lotNumber: "L-2611-00017", suggested: { code: "A-01", name: "Rack A shelf 1" }, fromName: "QA waiting cage", fromCode: "QC-01" })).toBe(
      "Next: put away Coconut Oil lot L-2611-00017 on A-01 (Rack A shelf 1). It waits at QA waiting cage.",
    );
    expect(putAwaySentence({ itemName: "Glycerin", lotNumber: "L-1", suggested: null, fromName: "", fromCode: "RCV" })).toBe("Next: put away Glycerin lot L-1. It waits at RCV.");
  });

  it("operators get no warehouse quick actions", () => {
    expect(floorQuickKeys([{ key: "scan" }, { key: "batches" }, { key: "putaway" }, { key: "move" }, { key: "count" }])).toEqual(["count"]);
  });

  it("activity uses the verb of the audit event, not of the record", () => {
    const r = activitySentence({ action: "inventory.stock_allocation.created", entityType: "sales_order", entityNumber: "SO-26-00001", actorName: "Lito Pascual", entityName: "Luntian Wellness Stores" });
    expect(`${r.who} ${r.text}`).toBe("Lito Pascual set aside stock for the customer order for Luntian Wellness Stores");
  });
});

describe("finding 5: a delivery coming shows its date", () => {
  it("stage 3 counts deliveries coming, late and due today", () => {
    expect(FLOW_STAGES.find((s) => s.key === "delivery_coming")!.counts.map((c) => c.key)).toEqual(["po_coming", "po_late", "po_due_today"]);
  });
  it("words with the nearest date", () => {
    expect(withDueWords("1 coming", "2026-11-11")).toBe("1 coming (11 Nov)");
    expect(withDueWords("0 coming", null)).toBe("0 coming");
    expect(fmtDayMonth("2026-11-11")).toBe("11 Nov");
    expect(fmtDayMonth(null)).toBe("—");
  });
});
