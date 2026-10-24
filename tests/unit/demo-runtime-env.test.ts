import { describe, expect, it } from "vitest";
import { type Env, NON_DEMO_USER_PREDICATE, demoModeState, isDemoEmail, isDemoMode } from "@/lib/demo";
import { applyRuntimeDefaults, originFromDomain, selfCheck } from "@/lib/runtime-env";

/** ADR-044: demo-mode switch, demo addresses, Railway defaults and the start-up self-check. */
describe("demo mode switch", () => {
  it("is off by default and with any value other than a true-ish DEMO_MODE", () => {
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ DEMO_MODE: "false" })).toBe(false);
    expect(isDemoMode({ DEMO_MODE: "" })).toBe(false);
    expect(isDemoMode({ ALLOW_DEMO_SEED: "yes" })).toBe(false); // the old name only ever accepted "true"
  });
  it("accepts DEMO_MODE=true/1/yes/on and the older ALLOW_DEMO_SEED=true", () => {
    for (const v of ["true", "TRUE", " 1 ", "yes", "on"]) expect(isDemoMode({ DEMO_MODE: v })).toBe(true);
    expect(demoModeState({ ALLOW_DEMO_SEED: "true" })).toEqual({ on: true, source: "ALLOW_DEMO_SEED", blockedByProduction: false });
  });
  it("is always off when APP_ENV=production", () => {
    expect(demoModeState({ DEMO_MODE: "true", APP_ENV: "production" })).toEqual({ on: false, source: "DEMO_MODE", blockedByProduction: true });
    expect(isDemoMode({ ALLOW_DEMO_SEED: "true", APP_ENV: "Production" })).toBe(false);
  });
});

describe("demo addresses", () => {
  it("accepts @bryels-care.test and the system actor only", () => {
    expect(isDemoEmail("owner@bryels-care.test")).toBe(true);
    expect(isDemoEmail(" Owner@Bryels-Care.TEST ")).toBe(true);
    expect(isDemoEmail("system@bryels-care.invalid")).toBe(true);
    for (const e of ["owner@bryelscare.com", "x@bryels-care.test.evil.com", "x@sub.bryels-care.test", "bryels-care.test", "@bryels-care.test", "other@bryels-care.invalid", "", null, undefined]) {
      expect(isDemoEmail(e), String(e)).toBe(false);
    }
  });
  it("the SQL predicate names the same rule", () => {
    expect(NON_DEMO_USER_PREDICATE).toContain("'%@bryels-care.test'");
    expect(NON_DEMO_USER_PREDICATE).toContain("'system@bryels-care.invalid'");
  });
});

describe("Railway defaults", () => {
  it("derives APP_ORIGIN from RAILWAY_PUBLIC_DOMAIN and never overrides a set value", () => {
    const env: Env = { RAILWAY_PUBLIC_DOMAIN: "bryels-demo.up.railway.app" };
    applyRuntimeDefaults(env);
    expect(env.APP_ORIGIN).toBe("https://bryels-demo.up.railway.app");
    const own: Env = { RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app", APP_ORIGIN: "https://erp.example.com" };
    applyRuntimeDefaults(own);
    expect(own.APP_ORIGIN).toBe("https://erp.example.com");
  });
  it("cleans up a pasted origin without https:// or with a trailing slash", () => {
    const a: Env = { APP_ORIGIN: "bryels-demo.up.railway.app/" };
    expect(applyRuntimeDefaults(a).some((n) => n.setting === "APP_ORIGIN" && n.level === "warn")).toBe(true);
    expect(a.APP_ORIGIN).toBe("https://bryels-demo.up.railway.app");
    const b: Env = { APP_ORIGIN: "https://bryels-demo.up.railway.app///" };
    applyRuntimeDefaults(b);
    expect(b.APP_ORIGIN).toBe("https://bryels-demo.up.railway.app");
    expect(originFromDomain("localhost:3401")).toBe("http://localhost:3401");
  });
  it("trusts X-Real-IP on Railway only, unless TRUSTED_PROXY_HEADER is set", () => {
    const off: Env = {};
    applyRuntimeDefaults(off);
    expect(off.TRUSTED_PROXY_HEADER).toBeUndefined();
    const on: Env = { RAILWAY_PROJECT_ID: "p" };
    applyRuntimeDefaults(on);
    expect(on.TRUSTED_PROXY_HEADER).toBe("x-real-ip");
    const own: Env = { RAILWAY_PROJECT_ID: "p", TRUSTED_PROXY_HEADER: "cf-connecting-ip" };
    applyRuntimeDefaults(own);
    expect(own.TRUSTED_PROXY_HEADER).toBe("cf-connecting-ip");
  });
  it("switches file storage to the bucket when every S3_* variable is present", () => {
    const partial: Env = { S3_ENDPOINT: "https://t3.storageapi.dev", S3_BUCKET: "b" };
    applyRuntimeDefaults(partial);
    expect(partial.FILE_STORAGE).toBeUndefined();
    const full: Env = { S3_ENDPOINT: "https://t3.storageapi.dev", S3_BUCKET: "b", S3_REGION: "auto", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
    applyRuntimeDefaults(full);
    expect(full.FILE_STORAGE).toBe("s3");
  });
  it("derives stable demo-only secrets in demo mode and never outside it", () => {
    const db = "postgresql://postgres:pw@postgres.railway.internal:5432/railway";
    const a: Env = { DEMO_MODE: "true", DATABASE_URL: db };
    const b: Env = { DEMO_MODE: "true", DATABASE_URL: db };
    applyRuntimeDefaults(a);
    applyRuntimeDefaults(b);
    expect(a.FILE_URL_SECRET!.length).toBeGreaterThanOrEqual(32);
    expect(a.FILE_URL_SECRET).toBe(b.FILE_URL_SECRET); // web and worker derive the same value
    expect(a.DATA_ENCRYPTION_KEY).toMatch(/^demo:[A-Za-z0-9+/=]{44}$/);
    expect(Buffer.from(a.DATA_ENCRYPTION_KEY!.slice(5), "base64")).toHaveLength(32);
    const real: Env = { DATABASE_URL: db, NODE_ENV: "production" };
    applyRuntimeDefaults(real);
    expect(real.FILE_URL_SECRET).toBeUndefined();
    expect(real.DATA_ENCRYPTION_KEY).toBeUndefined();
    const prod: Env = { DEMO_MODE: "true", APP_ENV: "production", DATABASE_URL: db };
    applyRuntimeDefaults(prod);
    expect(prod.FILE_URL_SECRET).toBeUndefined();
  });
});

describe("start-up self-check", () => {
  it("is fatal only without a usable DATABASE_URL, with a plain instruction", () => {
    const missing = selfCheck({}, "web");
    expect(missing.fatal).toBe(true);
    expect(missing.notes[0].message).toContain("${{Postgres.DATABASE_URL}}");
    expect(selfCheck({ DATABASE_URL: "${{Postgres.DATABASE_URL}}" }).fatal).toBe(true);
    expect(selfCheck({ DATABASE_URL: "mysql://x" }).fatal).toBe(true);
    const demo = selfCheck({ DATABASE_URL: "postgres://postgres@localhost:5432/x", DEMO_MODE: "true", NODE_ENV: "production", RAILWAY_PUBLIC_DOMAIN: "a.up.railway.app" }, "web");
    expect(demo.fatal).toBe(false);
    expect(demo.notes.filter((n) => n.level === "error")).toEqual([]);
  });
  it("names the missing production secrets without failing", () => {
    const r = selfCheck({ DATABASE_URL: "postgres://x@y/z", NODE_ENV: "production", APP_ORIGIN: "https://erp.example.com" }, "web");
    expect(r.fatal).toBe(false);
    expect(r.notes.map((n) => n.setting)).toEqual(expect.arrayContaining(["FILE_URL_SECRET", "DATA_ENCRYPTION_KEY", "FILE_STORAGE"]));
  });
  it("reports DEMO_MODE being ignored on APP_ENV=production", () => {
    const r = selfCheck({ DATABASE_URL: "postgres://x@y/z", DEMO_MODE: "true", APP_ENV: "production" }, "web");
    expect(r.notes.find((n) => n.setting === "DEMO_MODE")?.level).toBe("error");
  });
});
