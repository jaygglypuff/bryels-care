/**
 * ADR-135: the in-app keypad, a physical keyboard and keyboard-wedge devices (USB scale, scanner) follow one rule set
 * (src/ui/keypad-keys.ts). Values stay strings (no floating point).
 */
import { describe, expect, it } from "vitest";
import { cleanTyped, keyFromEvent, pressKey, resolveNumberEntry } from "@/ui/keypad-keys";
import { SETTINGS, settingDefinition } from "@/lib/settings";

const type = (keys: string[], rules: Parameters<typeof pressKey>[2]) =>
  keys.reduce((v, key) => {
    const k = keyFromEvent({ key }, rules);
    return k === null || k === "submit" ? v : pressKey(v, k, rules);
  }, "");

describe("pressKey (the keypad's rule)", () => {
  it("decimal: one dot, digits, back and clear", () => {
    const d = { decimal: true, maxLength: 10 };
    expect(pressKey("12", ".", d)).toBe("12.");
    expect(pressKey("12.", ".", d)).toBe("12.");
    expect(pressKey("12.5", "back", d)).toBe("12.");
    expect(pressKey("12.5", "clear", d)).toBe("");
    expect(pressKey("12.5", "submit", d)).toBe("12.5");
  });
  it("whole numbers ignore the dot", () => {
    expect(pressKey("12", ".", {})).toBe("12");
  });
  it("a leading zero is replaced in numbers, kept before a dot and in lot characters", () => {
    expect(pressKey("0", "5", { decimal: true })).toBe("5");
    expect(pressKey("0", ".", { decimal: true })).toBe("0.");
    expect(pressKey("0", "5", { letters: true })).toBe("05");
  });
  it("stops at maxLength", () => {
    expect(pressKey("1234567890", "1", { maxLength: 10 })).toBe("1234567890");
    expect(pressKey("1234567890", "back", { maxLength: 10 })).toBe("123456789");
  });
  it("letters only in a lot field", () => {
    expect(pressKey("12", "A", {})).toBe("12");
    expect(pressKey("12", "A", { letters: true })).toBe("12A");
    expect(pressKey("12", "-", { letters: true })).toBe("12-");
    expect(pressKey("12", "G", { letters: true })).toBe("12");
  });
});

describe("keyFromEvent (physical keyboard and wedge devices)", () => {
  it("maps Enter, Backspace, Delete/Escape and digits", () => {
    expect(keyFromEvent({ key: "Enter" })).toBe("submit");
    expect(keyFromEvent({ key: "Backspace" })).toBe("back");
    expect(keyFromEvent({ key: "Delete" })).toBe("clear");
    expect(keyFromEvent({ key: "Escape" })).toBe("clear");
    expect(keyFromEvent({ key: "7" })).toBe("7");
  });
  it("dot and comma are the decimal point only in a decimal field", () => {
    expect(keyFromEvent({ key: "." }, { decimal: true })).toBe(".");
    expect(keyFromEvent({ key: "," }, { decimal: true })).toBe(".");
    expect(keyFromEvent({ key: "." }, {})).toBeNull();
  });
  it("leaves Tab, arrows and shortcuts to the browser", () => {
    expect(keyFromEvent({ key: "Tab" })).toBeNull();
    expect(keyFromEvent({ key: "ArrowLeft" })).toBeNull();
    expect(keyFromEvent({ key: "v", ctrlKey: true })).toBeNull();
    expect(keyFromEvent({ key: "1", metaKey: true })).toBeNull();
    expect(keyFromEvent({ key: "a" })).toBeNull();
  });
  it("letters in either case in a lot field", () => {
    expect(keyFromEvent({ key: "b" }, { letters: true })).toBe("B");
    expect(keyFromEvent({ key: "-" }, { letters: true })).toBe("-");
  });
  it("typing 12.5 then Enter on a weight field gives 12.5 (the ✓ is not a character)", () => {
    expect(type(["1", "2", ".", "5", "Enter"], { decimal: true, maxLength: 10 })).toBe("12.5");
  });
  it("a whole-number field ignores a scale's decimal point", () => {
    expect(type(["1", "2", ".", "5"], {})).toBe("125");
  });
});

describe("cleanTyped (own keyboard, paste, scale bursts)", () => {
  it("keeps only what the keypad could type", () => {
    expect(cleanTyped(" 12.50 kg", { decimal: true })).toBe("12.50");
    expect(cleanTyped("12,5", { decimal: true })).toBe("12.5");
    expect(cleanTyped("1.2.3", { decimal: true })).toBe("1.23");
    expect(cleanTyped("007", {})).toBe("7");
    expect(cleanTyped("12345678901", { maxLength: 10 })).toBe("1234567890");
    expect(cleanTyped("ab-12", { letters: true })).toBe("AB-12");
    expect(cleanTyped("-5", { decimal: true })).toBe("5");
  });
  it("is stable: cleaning a clean value changes nothing", () => {
    for (const v of ["12.5", "0.25", "90", ""]) expect(cleanTyped(v, { decimal: true })).toBe(v);
  });
});

describe("resolveNumberEntry and the setting", () => {
  it("the device choice wins; automatic = keypad on touch screens, typing on computers", () => {
    expect(resolveNumberEntry("auto", null, true)).toBe("keypad");
    expect(resolveNumberEntry("auto", null, false)).toBe("keyboard");
    expect(resolveNumberEntry("keypad", null, false)).toBe("keypad");
    expect(resolveNumberEntry("keyboard", null, true)).toBe("keyboard");
    expect(resolveNumberEntry("keypad", "keyboard", true)).toBe("keyboard");
    expect(resolveNumberEntry("keyboard", "keypad", false)).toBe("keypad");
  });
  it("ui.number_entry is a Screens choice, default automatic, changed directly", () => {
    const d = settingDefinition("ui.number_entry")!;
    expect(SETTINGS["ui.number_entry"].default).toBe("auto");
    expect(d.group).toBe("Screens");
    expect(d.scopes).toEqual(["organization"]);
    expect(d.requiresApproval).toBeUndefined();
    expect(d.choices?.map((c) => c.value)).toEqual(["auto", "keypad", "keyboard"]);
    expect(d.choices?.map((c) => c.label)).toEqual(["Automatic (keypad on phones, typing on computers)", "Big keypad on screen", "Phone or tablet's own keyboard"]);
    expect(SETTINGS["ui.number_entry"].schema.safeParse("phone").success).toBe(false);
    for (const text of [d.label, d.description!, d.whoChanges!]) for (const s of text.split(/(?<=[.:])\s+/)) expect(s.split(/\s+/).length).toBeLessThanOrEqual(32);
  });
});
