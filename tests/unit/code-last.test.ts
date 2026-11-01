import { describe, expect, it } from "vitest";
import { codeLast } from "@/lib/code-last";

describe("codeLast (names before codes in messages and alerts, UX audit C #6)", () => {
  it("moves record numbers out of the sentence and keeps the words", () => {
    expect(codeLast("Order SO-26-00012 confirmed")).toEqual({ text: "Order confirmed", codes: ["SO-26-00012"] });
    expect(codeLast("DR DRM-2610-018 not acknowledged after 4 days")).toEqual({ text: "Not acknowledged after 4 days", codes: ["DRM-2610-018"] });
    expect(codeLast("Batch BM-2610-0026 waits for a QA decision")).toEqual({ text: "Batch waits for a QA decision", codes: ["BM-2610-0026"] });
    expect(codeLast("Problem report DEV-26-0001 on batch B-26-0004")).toEqual({ text: "Problem report on batch", codes: ["DEV-26-0001", "B-26-0004"] });
  });

  it("leaves sentences without a record number alone, and never returns an empty sentence", () => {
    expect(codeLast("Delivery to Isla Spa Supplies has no signed receipt after 4 days")).toEqual({ text: "Delivery to Isla Spa Supplies has no signed receipt after 4 days", codes: [] });
    expect(codeLast("SO-26-00012")).toEqual({ text: "SO-26-00012", codes: [] });
    expect(codeLast("Coconut Oil goes out of date in 3 days").codes).toEqual([]);
  });
});
