/**
 * ADR-132 §5 (round 5 C report B22): one help door per page. A page's plain "?" carries `data-page-help`, which the
 * stylesheet hides where the frame shows its own "?" (`[data-frame-help] [data-page-help]` from 640 px); a "?" with
 * its own words or for one step keeps showing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Help } from "@/ui/help/help";

const root = path.resolve(__dirname, "../..");
// The components use the classic JSX transform under vitest.
(globalThis as unknown as { React: typeof React }).React = React;

describe("one help door per page", () => {
  it("a plain page '?' is marked as the page's door; words or a step are not", () => {
    expect(renderToStaticMarkup(createElement(Help, { screen: "sales.order" }))).toContain("data-page-help");
    expect(renderToStaticMarkup(createElement(Help, { screen: "production.weigh", text: "Help: weighing" }))).not.toContain("data-page-help");
    expect(renderToStaticMarkup(createElement(Help, { screen: "production.step", step: "mixing" }))).not.toContain("data-page-help");
  });

  it("the frame marks <main> when it shows its '?', and the stylesheet hides the page's door there", () => {
    const shell = readFileSync(path.join(root, "src/app/(app)/shell.tsx"), "utf8");
    expect(shell).toMatch(/<main[^>]*data-frame-help=\{loadHelp && !floor \? "on" : undefined\}/);
    const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    // ADR-136: the frame's "?" shows at every width, so the page's own door is hidden at every width.
    expect(css).toMatch(/^\[data-frame-help\] \[data-page-help\] \{ display: none; \}/m);
    expect(shell).toMatch(/loadHelp && !floor && \(\s*<div className="block">/);
  });
});
