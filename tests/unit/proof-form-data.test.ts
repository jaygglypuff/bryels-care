import { describe, expect, it } from "vitest";
import { proofFormData } from "@/app/(app)/sales/proof-form-data";

/**
 * Round 5 A B11 / ADR-133 item 2: proof of delivery Save after a first failed try. The image is added when Save is
 * tapped, so an emptied file input (React resets a form after an action) can no longer send a signature-less retry.
 */
const png = () => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "signature.png", { type: "image/png" });

describe("proofFormData", () => {
  it("adds the drawn signature at Save, replacing a stale (emptied) file field", () => {
    const fd = new FormData();
    fd.set("receivedByName", "Marco Tan");
    fd.set("file", new File([], "")); // what a reset hidden input used to send
    expect(proofFormData(fd, "drawn", png())).toBeNull();
    const f = fd.getAll("file");
    expect(f).toHaveLength(1);
    expect((f[0] as File).size).toBe(7);
    expect(fd.get("kind")).toBe("drawn");
    expect(fd.get("receivedByName")).toBe("Marco Tan");
  });

  it("the retry after a refusal sends the same signature again (the canvas is read again, not a cleared input)", () => {
    const first = new FormData();
    expect(proofFormData(first, "drawn", png())).toBeNull();
    const retry = new FormData();
    expect(proofFormData(retry, "drawn", png())).toBeNull();
    expect((retry.get("file") as File).size).toBe((first.get("file") as File).size);
  });

  it("refuses in plain words before sending when there is no signature or photo", () => {
    expect(proofFormData(new FormData(), "drawn", null)).toBe("Ask the person receiving to sign in the box first.");
    expect(proofFormData(new FormData(), "photo", new File([], "x.jpg"))).toBe("Take or choose the photo of the signed copy first.");
  });

  it("name only sends no image, even when one was drawn before switching", () => {
    const fd = new FormData();
    fd.set("file", png());
    expect(proofFormData(fd, "name_only", png())).toBeNull();
    expect(fd.get("file")).toBeNull();
    expect(fd.get("kind")).toBe("name_only");
  });
});
