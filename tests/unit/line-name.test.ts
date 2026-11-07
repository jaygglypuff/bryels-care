import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";
import { lineNameWords, splitLineName } from "@/lib/line-name";
import { LineName } from "@/ui/line-name";

// The unit runner compiles JSX with the classic runtime.
(globalThis as unknown as { React: typeof React }).React = React;

describe("names before codes on document lines (ADR-124 item 2)", () => {
  it("splits a stored 'CODE · Name' snapshot, name first", () => {
    expect(splitLineName("PRD-0002 · Aloe Hand Lotion")).toEqual({ name: "Aloe Hand Lotion", code: "PRD-0002" });
    expect(splitLineName("RM-COCO-01 · Coconut Oil · drum")).toEqual({ name: "Coconut Oil · drum", code: "RM-COCO-01" });
    expect(lineNameWords("ACS-135 · Acapulco Soap 135 g")).toBe("Acapulco Soap 135 g (ACS-135)");
  });

  it("keeps hand-typed descriptions whole", () => {
    expect(splitLineName("Delivery fee")).toEqual({ name: "Delivery fee", code: null });
    expect(splitLineName("Freight to the north · July")).toEqual({ name: "Freight to the north · July", code: null });
    expect(splitLineName("delivery · fee")).toEqual({ name: "delivery · fee", code: null });
    expect(splitLineName(null)).toEqual({ name: "", code: null });
  });

  it("renders the name, then the code small and grey", () => {
    const html = renderToStaticMarkup(createElement(LineName, { description: "PRD-0002 · Aloe Hand Lotion" }));
    expect(html.indexOf("Aloe Hand Lotion")).toBeLessThan(html.indexOf("PRD-0002"));
    expect(html).toContain('data-testid="line-code"');
    expect(html).toContain("text-muted");
    const fromParts = renderToStaticMarkup(createElement(LineName, { name: "Aloe Hand Lotion", code: "PRD-0002", print: true }));
    expect(fromParts.indexOf("Aloe Hand Lotion")).toBeLessThan(fromParts.indexOf("PRD-0002"));
  });
});
