/**
 * Live check of the small demo, 2026-11-06: source guards and pure helpers for findings 7 and 8.
 * - 7: a liquid shows its volume ("250 mL a bottle"); one role word source for screens and the printed record.
 * - 8: place names first (code small and grey) on the step card, the weighing list and Put away.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pieceSizeWords } from "@/lib/piece-size";
import { PLAIN_ROLE, plainRole, plainRoleName } from "@/lib/role-words";
import * as uiRoles from "@/ui/role-names";

const APP = join(process.cwd(), "src", "app", "(app)");
const read = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");

describe("finding 7: piece size in the words people use", () => {
  it("a liquid sold by volume shows its volume, a soap its mass per bar", () => {
    expect(pieceSizeWords({ family: "Lotion", unitNetMassG: "255.000000", netContentQty: "250.000000", netContentUom: "mL" })).toBe("250 mL a bottle");
    expect(pieceSizeWords({ family: "Soap", unitNetMassG: "135.000000", netContentQty: "135", netContentUom: "g" })).toBe("135 g a bar");
    expect(pieceSizeWords({ family: "Other", unitNetMassG: "50" })).toBe("50 g a piece");
    expect(pieceSizeWords({ family: "Lotion", unitNetMassG: "1020", netContentQty: "1", netContentUom: "L" })).toBe("1 L a bottle");
  });
  it("product pages use it instead of '255 g a piece'", () => {
    for (const f of [["masterdata", "products", "page.tsx"], ["masterdata", "products", "[id]", "page.tsx"]]) {
      const src = read(...f);
      expect(src, f.join("/")).toContain("pieceSizeWords(p)");
      expect(src, f.join("/")).not.toContain('"g", 0)} a piece');
    }
  });
});

describe("finding 7: one role word source", () => {
  it("the screens re-export the same words the printed record uses", () => {
    expect(uiRoles.PLAIN_ROLE).toBe(PLAIN_ROLE);
    expect(plainRole("production_operator")).toBe("Machine operator");
    expect(plainRoleName("Production Operator")).toBe("Machine operator");
    const bmr = readFileSync(join(process.cwd(), "src", "modules", "production", "bmr.ts"), "utf8");
    expect(bmr).toContain("plainRole(r.code, r.name)");
  });
});

describe("finding 8: place names before codes", () => {
  it("the packaging step, the weighing list and Put away name the place", () => {
    for (const f of [
      ["production", "orders", "[workOrderId]", "step", "[n]", "packaging-box.tsx"],
      ["production", "orders", "[workOrderId]", "weigh", "more", "page.tsx"],
      ["inventory", "receive", "put-away", "page.tsx"],
    ]) {
      const src = read(...f);
      expect(src, f.join("/")).toMatch(/PlaceName|placeWords/);
      expect(src, f.join("/")).not.toMatch(/shelf \{[a-z]+\.locationCode\}|at \$\{t\.fromCode\} →/);
    }
    const form = read("inventory", "receive", "put-away", "put-away-form.tsx");
    expect(form).toContain("to?.title || to?.code");
  });
});
