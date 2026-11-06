/** ADR-110 C7 (walk P4): sack labels print the quantity per sack, or none, never the whole lot on every sack. */
import { describe, expect, it } from "vitest";
import { labelRendererV1, type LabelData } from "@/modules/documents/renderers/label-v1";
import { labelRendererV2 } from "@/modules/documents/renderers/label-v2";
import { renderFrozen } from "@/modules/documents/renderers/registry";
import { perContainerQuantity, sackLine } from "@/modules/documents/sack-quantity";
import { SACK, frozen } from "./fixtures";

describe("quantity per sack", () => {
  it("one container keeps the lot quantity; an even split gives the quantity per sack", () => {
    expect(perContainerQuantity("200000", null, "200000")).toEqual({ perContainer: expect.anything(), containers: 1 });
    expect(perContainerQuantity("200000", 4, "200000").perContainer?.toString()).toBe("50000");
  });
  it("an uneven split, or a lot already used, prints no quantity", () => {
    expect(perContainerQuantity("600", 7, "600").perContainer).toBeNull();
    expect(perContainerQuantity("200000", 4, "150000").perContainer).toBeNull();
  });
  it("copies are numbered only when one label is printed per sack", () => {
    expect(sackLine("50 kg each", 4, 2, 4)).toBe("50 kg each · sack 2 of 4");
    expect(sackLine(null, 4, 3, 4)).toBe("Sack 3 of 4");
    expect(sackLine("50 kg each", 4, 1, 1)).toBe("50 kg each"); // a reprint of one label is not numbered
    expect(sackLine("200 kg", null, 1, 1)).toBe("200 kg");
  });
  it("the rendered labels (v1 and v2) say 50 kg each and sack n of 4, never 200 kg", () => {
    const d: LabelData = { ...SACK, copies: 4, label: { ...SACK.label, fields: [...new Set([...SACK.label.fields, "quantity" as const])] }, entity: { ...SACK.entity, quantityText: "50 kg each", containerCount: 4 } };
    for (const r of [labelRendererV1, labelRendererV2]) {
      const body = renderFrozen(r.defaultDefinition("label", "label/material/v1"), "label", frozen(d)).body.value;
      for (let i = 1; i <= 4; i++) expect(body).toContain(`50 kg each · sack ${i} of 4`);
      expect(body).not.toContain("200");
    }
  });
  it("labels without a container count render exactly as before (stored checksums unchanged)", () => {
    expect(renderFrozen(labelRendererV1.defaultDefinition("label", "label/material/v1"), "label", frozen(SACK)).checksumSha256).toBe("fa2034305c0d5c0245db049bb1f32b772ae7895135e1c2f2f195248d2b92256b");
  });
});
