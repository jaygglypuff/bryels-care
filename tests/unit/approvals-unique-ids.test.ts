/**
 * To approve (src/app/(app)/approvals): from 1280 px the selected item shows its Approve / Reject controls in the side
 * panel while the row copy is hidden by CSS, so both copies are in the page. They must never share a field id (the
 * "Why?" label would point at the wrong box) and each Approve names the item it decides.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The unit runner compiles JSX with the classic runtime.
(globalThis as unknown as { React: typeof React }).React = React;

vi.mock("@/app/(app)/approvals/actions", () => ({ decideApprovalAction: async () => ({ ok: true }) }));

describe("To approve: row and side-panel controls", () => {
  it("two copies of the same item have different ids and a named Approve", async () => {
    const { InlineDecision } = await import("@/app/(app)/approvals/forms");
    const props = { kind: "purchase_order", entityId: "11111111-1111-4111-8111-111111111111", what: "purchase order PO-26-00001", rejectLabel: "Send back" };
    const html = renderToStaticMarkup(createElement("div", null, createElement(InlineDecision, props), createElement(InlineDecision, { ...props, primary: false })));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(ids.length);
    const fors = [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]);
    expect(fors.sort()).toEqual([...ids].sort());
    expect(html.match(/aria-label="Approve purchase order PO-26-00001"/g)?.length).toBe(2);
  });
});
