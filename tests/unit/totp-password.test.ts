/** W2E: RFC 6238 vectors, base32, secret encryption round trip, password policy, log redaction. */
import { describe, expect, it } from "vitest";
import { passwordProblem } from "@/lib/auth/password-policy";
import { isPrivileged, sensitivityOf } from "@/lib/auth/sensitivity";
import { looksLikeToken, newToken, redact } from "@/lib/auth/tokens";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, totpAt, verifyTotp } from "@/lib/auth/totp";

describe("TOTP (RFC 6238 SHA-1 vectors, 6 digits)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30))).toBe(code);
  });
  it("accepts ±1 step, refuses replays and malformed codes", () => {
    const now = new Date(1234567890 * 1000);
    const step = Math.floor(1234567890 / 30);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), now, step)).toBeNull(); // already used
    expect(verifyTotp(secret, "12345", now, null)).toBeNull();
  });
  it("base32 round trip and AES-GCM secret round trip", () => {
    const b = Buffer.from("any bytes here!!");
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    const { enc, keyId } = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc, keyId)).toBe("JBSWY3DPEHPK3PXP");
  });
});

describe("password policy (docs/security.md §3.2)", () => {
  const c = { email: "rhea.mendoza@bryels-care.test", displayName: "Rhea Mendoza", minLength: 12 };
  it("refuses short, common, context-containing and company-name passwords", () => {
    expect(passwordProblem("short", c)).toMatch(/at least 12/);
    expect(passwordProblem("password1234", c)).toMatch(/too common/);
    expect(passwordProblem("rhea.mendoza-2026", c)).toMatch(/email name/);
    expect(passwordProblem("hello mendoza family", c)).toMatch(/your name/);
    expect(passwordProblem("i work at bryels care", c)).toMatch(/company/);
    expect(passwordProblem("x".repeat(129), c)).toMatch(/at most/);
    expect(passwordProblem("tamarind leaves at dawn 42", c)).toBeNull();
  });
});

describe("tokens, redaction, sensitivity", () => {
  it("tokens are 32 random bytes in base64url", () => {
    const t = newToken();
    expect(looksLikeToken(t)).toBe(true);
    expect(newToken()).not.toBe(t);
  });
  it("redacts secret keys and long base64url runs (US-1-11 AC3)", () => {
    const t = newToken();
    expect(redact({ token: "abc", url: `/invite#token=${t}`, nested: { password: "x", ok: "fine" } })).toEqual({ token: "•••", url: "/invite#token=•••", nested: { password: "•••", ok: "fine" } });
  });
  it("sensitivity follows the catalogue; privileged = any R string or owner/admin role", () => {
    expect(sensitivityOf("identity.user.admin")).toBe("R");
    expect(sensitivityOf("identity.user.create")).toBe("S");
    expect(sensitivityOf("inventory.lot.view")).toBe("N");
    expect(isPrivileged(["inventory.lot.view"], ["warehouse_operator"])).toBe(false);
    expect(isPrivileged(["quality.disposition.approve"], ["qa_qc"])).toBe(true);
    expect(isPrivileged([], ["system_admin"])).toBe(true);
  });
});
