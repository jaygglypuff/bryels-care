/** W3A unit rules: period arithmetic (§1.6), value formatting (n/a, never 0 %), deltas, percentile rule, catalogue integrity. */
import { describe, expect, it } from "vitest";
import { KPIS, OWNER_KPIS, DASHBOARD_KPIS, kpiByCode } from "@/modules/analytics/kpi/catalogue";
import { aggregate, type KpiRow } from "@/modules/analytics/kpi/engine";
import { addMonths, bucketEnd, bucketStart, resolvePeriod, weekStart, zonedStart } from "@/modules/analytics/kpi/time";
import { deltaOf, fmtKpi } from "@/ui/charts/format";
import { niceMax } from "@/ui/charts/charts";

const row = (num: string | null, den: string | null = null): KpiRow => ({ site_id: "s", ref_type: "x", ref_id: null, ref_number: null, basis_at: null, num, den, item: null, detail: null, category: null });

describe("periods", () => {
  it("local midnight in Manila is 16:00 UTC the day before", () => {
    expect(zonedStart("2025-04-01", "Asia/Manila").toISOString()).toBe("2025-03-31T16:00:00.000Z");
  });
  it("weeks start on Monday and months on the 1st", () => {
    expect(weekStart("2025-03-30")).toBe("2025-03-24"); // Sunday
    expect(weekStart("2025-03-31")).toBe("2025-03-31"); // Monday
    expect(bucketStart("2025-03-17", "month")).toBe("2025-03-01");
    expect(bucketEnd("2025-12-01", "month")).toBe("2026-01-01");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-01");
  });
  it("this month compares with the same days of last month, clamped to its length", () => {
    const { current, previous } = resolvePeriod("month", new Date("2025-03-30T02:00:00Z"), "Asia/Manila");
    expect([current.fromDate, current.toDate]).toEqual(["2025-03-01", "2025-03-31"]);
    expect([previous.fromDate, previous.toDate]).toEqual(["2025-02-01", "2025-03-01"]);
  });
});

describe("aggregation", () => {
  it("ratios are n/a, never 0 %, when the denominator is empty", () => {
    const def = kpiByCode("KPI-SAL-02")!;
    expect(aggregate(def, []).value).toBeNull();
    expect(fmtKpi("ratio", null)).toBe("n/a");
    expect(aggregate(def, [row("1", "1"), row("0", "1"), row("1", "1")]).value!.toString()).toBe("0.6666666667");
  });
  it("median is the lower middle value (percentile_disc), p90 likewise", () => {
    const med = kpiByCode("KPI-QUA-01")!;
    const p90 = kpiByCode("KPI-QUA-01P")!;
    const rows = ["4", "1", "3", "2"].map((n) => row(n));
    expect(aggregate(med, rows).value!.toString()).toBe("2");
    expect(aggregate(p90, rows).value!.toString()).toBe("4");
  });
  it("sums are exact decimals", () => {
    expect(aggregate(kpiByCode("KPI-FIN-02")!, [row("0.1"), row("0.2")]).value!.toString()).toBe("0.3");
  });
});

describe("formatting", () => {
  it("formats per unit and states the comparison period", () => {
    expect(fmtKpi("qty_g", "12500")).toBe("12.5 kg");
    expect(fmtKpi("ratio", "0.9523")).toBe("95.2 %");
    expect(deltaOf("ratio", "up", "0.9", "0.8", "last week")).toMatchObject({ tone: "good", text: "+10.0 points vs last week" });
    expect(deltaOf("count", "down", "5", "4", "yesterday")).toMatchObject({ tone: "bad", direction: "up" });
    expect(niceMax(7)).toBe(10);
    expect(niceMax(0)).toBe(1);
  });
});

describe("catalogue", () => {
  it("codes are unique and every composition references a catalogue KPI", () => {
    const codes = KPIS.map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const list of Object.values(DASHBOARD_KPIS)) for (const c of list) expect(kpiByCode(c), c).toBeTruthy();
    for (const o of OWNER_KPIS) for (const c of o.builtFrom) expect(kpiByCode(c), c).toBeTruthy();
    expect(OWNER_KPIS.map((o) => o.code)).toEqual(Array.from({ length: 14 }, (_, i) => `KPI-OWN-${String(i + 1).padStart(2, "0")}`));
  });
  it("money KPIs need the financial permission; only KPI-FIN-02 is an Estimate", () => {
    for (const k of KPIS.filter((k) => k.unit === "money")) expect(k.permissions).toContain("analytics.financial_kpi.view");
    expect(KPIS.filter((k) => k.label === "estimate").map((k) => k.code)).toEqual(["KPI-FIN-02"]);
  });
});
