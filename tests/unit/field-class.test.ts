/** A caller's width or height on a field replaces the base one instead of losing to it (layout fix, R5). */
import { describe, expect, it } from "vitest";
import { fieldClass, inputClass } from "@/ui/core";

describe("fieldClass", () => {
  it("a caller width replaces w-full", () => {
    const c = fieldClass(inputClass, "w-24 shrink-0").split(" ");
    expect(c).toContain("w-24");
    expect(c).not.toContain("w-full");
  });
  it("responsive or max widths keep the base width", () => {
    expect(fieldClass(inputClass, "sm:w-48").split(" ")).toContain("w-full");
    expect(fieldClass(inputClass, "max-w-[260px]").split(" ")).toContain("w-full");
  });
  it("min height and text size can be overridden", () => {
    const c = fieldClass(inputClass, "!min-h-[36px] min-h-[36px] text-[13px]").split(" ");
    expect(c).not.toContain("min-h-[44px]");
    expect(c).not.toContain("text-[14px]");
  });
  it("no caller class = base unchanged", () => expect(fieldClass(inputClass)).toBe(inputClass));
});
