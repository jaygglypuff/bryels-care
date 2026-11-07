import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useClientKey } from "@/ui/use-client-key";

/**
 * Hydration (ADR-125 item 5): a random idempotency key made during render differs between the server HTML and the
 * browser's first render ("hydration mismatch" on the weigh screen). `useClientKey` renders nothing random on the
 * server and on the first client render; the key appears after hydration.
 */
function Form() {
  const key = useClientKey();
  return createElement("form", null, key ? createElement("input", { type: "hidden", name: "idempotencyKey", value: key, readOnly: true }) : null);
}

describe("useClientKey", () => {
  it("renders the same HTML every time on the server (no random key in the markup)", () => {
    const a = renderToString(createElement(Form));
    const b = renderToString(createElement(Form));
    expect(a).toBe(b);
    expect(a).not.toContain("idempotencyKey");
  });
});
