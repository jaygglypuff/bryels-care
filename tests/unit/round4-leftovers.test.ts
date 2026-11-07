/**
 * Round 4 leftovers (docs/ux-audit/README.md, 2026-11-07): Compare over time dots get an invisible >= 44 px target,
 * Problems & alerts has one green button (the first row), the recipe wizard shows its progress bar before the intro.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart } from "@/ui/charts/charts";

// The unit runner compiles JSX with the classic runtime.
(globalThis as unknown as { React: typeof React }).React = React;

const ROOT = join(__dirname, "../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Compare over time: dot tap targets", () => {
  const chart = (n: number) =>
    renderToStaticMarkup(
      createElement(LineChart, {
        ariaLabel: "test",
        fmt: (v: number) => String(v),
        labels: Array.from({ length: n }, (_, i) => `M${i + 1}`),
        series: [{ key: "a", label: "Orders", color: "#123456", values: Array.from({ length: n }, (_, i) => i + 1), hrefs: Array.from({ length: n }, (_, i) => `/sales?m=${i}`) }],
      }),
    );
  const hits = (html: string) => [...html.matchAll(/<rect data-testid="chart-hit" x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)" height="([\d.]+)" fill="transparent"/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]), h: Number(m[3]) }));

  it("each linked dot has an invisible target 88 of 640 units tall (>= 44 px from a 320 px wide chart)", () => {
    const h = hits(chart(4));
    expect(h).toHaveLength(4);
    for (const r of h) {
      expect(r.h).toBe(88);
      expect(r.w).toBe(88);
      expect((r.h * 320) / 640).toBeGreaterThanOrEqual(44);
    }
  });
  it("targets never overlap their neighbours when dots are close", () => {
    const h = hits(chart(24));
    expect(h).toHaveLength(24);
    for (let i = 1; i < h.length; i++) expect(h[i].x).toBeGreaterThanOrEqual(h[i - 1].x + h[i - 1].w - 0.001);
  });
  it("the visible dot is unchanged (r 3.5, last 4.5)", () => {
    const html = chart(3);
    expect(html.match(/r="3.5"/g)).toHaveLength(2);
    expect(html.match(/r="4.5"/g)).toHaveLength(1);
  });
});

describe("Problems & alerts: one green button", () => {
  it("only the first row's button is primary, the others secondary", () => {
    const p = src("src/app/(app)/action-centre/page.tsx");
    expect(p).toMatch(/variant=\{first \? "primary" : "secondary"\}/);
    expect(p).toMatch(/first=\{i\.id === firstId\}/);
    expect(p).toMatch(/const firstId = groups\[0\]\?\.\[1\]\[0\]\?\.id/);
  });
});

describe("Recipe wizard: the progress bar comes first", () => {
  it("the intro is passed to the wizard and rendered small after the steps list", () => {
    const page = src("src/app/(app)/masterdata/recipes/new/page.tsx");
    expect(page).not.toMatch(/<PageIntro>/);
    expect(page).toMatch(/intro="This screen is for making the recipe/);
    const w = src("src/app/(app)/masterdata/recipes/wizard.tsx");
    const nav = w.indexOf('aria-label="Recipe steps"');
    const ol = w.indexOf("</ol>", nav);
    const intro = w.indexOf('data-testid="wizard-intro"');
    expect(nav).toBeGreaterThan(0);
    expect(intro).toBeGreaterThan(ol);
    expect(w.slice(w.lastIndexOf("<p", intro), intro)).toMatch(/text-\[13px\]/);
  });
});

describe("label on each piece (demo rehearsal 2026-11-07)", () => {
  it("says piece, not bar, so a lotion bottle never reads \"one for each bar\"", async () => {
    const { LABEL_KIND_WORDS } = await import("@/ui/labels/words");
    const w = LABEL_KIND_WORDS.bar;
    expect(w.one).toBe("piece");
    expect(w.many).toBe("pieces");
    expect(w.title).toBe("Label for each piece");
    expect(`${w.stick} ${w.scan}`).not.toMatch(/\bbars?\b/);
  });
});
