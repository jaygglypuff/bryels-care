/**
 * US-1-25 log-field and error-reporting unit tests: every line carries service/release/appEnv
 * and the request context; redaction of tokens, passwords, cookies, authorization headers and
 * connection strings; the error adapter never reports expected errors, is disabled without a DSN
 * and sends no cookies, headers, bodies or query strings.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@/lib/errors";
import { REDACTED, buildRecord, logger, redact, setLogSink, withLogContext } from "@/lib/log";
import { buildErrorEvent, parseDsn, reportError, setErrorReportTransport } from "@/lib/log/error-reporter";

const envBackup = { ...process.env };
afterEach(() => {
  process.env = { ...envBackup };
});

describe("structured log lines", () => {
  it("carry base fields and the request context", () => {
    process.env.RELEASE = "r-123";
    process.env.APP_ENV = "staging";
    process.env.RAILWAY_REPLICA_ID = "rep-1";
    const rec = withLogContext({ requestId: "req-abcdef12", userId: "u1", siteId: "s1", module: "inventory", command: "inventory.movement.transfer" }, () => buildRecord("info", "api command", { durationMs: 12, outcome: "ok" }));
    expect(rec).toMatchObject({ level: "info", msg: "api command", service: "web", release: "r-123", appEnv: "staging", replica: "rep-1", requestId: "req-abcdef12", userId: "u1", siteId: "s1", module: "inventory", command: "inventory.movement.transfer", durationMs: 12, outcome: "ok" });
    expect(typeof rec.time).toBe("string");
  });

  it("writes JSON lines through the sink and respects LOG_LEVEL", () => {
    const lines: string[] = [];
    const restore = setLogSink((l) => lines.push(l));
    process.env.LOG_LEVEL = "info";
    logger.debug("hidden");
    logger.info("shown", { password: "hunter2" });
    restore();
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.msg).toBe("shown");
    expect(rec.password).toBe(REDACTED);
  });

  it("redacts secrets by key and token-like substrings", () => {
    const out = redact({
      password: "x",
      sessionToken: "y",
      headers: { authorization: "Bearer abc", cookie: "bc_session=zzz" },
      url: "/api/files/1?sig=abcdefghijklmnopqrstuvwxyz0123&x=1",
      dsn: "https://key@host/1",
      note: "postgres://bc_app:pa55word@db.internal:5432/app and Bearer eyJhbGciOiJIUzI1NiJ9",
      passed: 3,
    }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED);
    expect(out.sessionToken).toBe(REDACTED);
    expect(out.headers).toEqual({ authorization: REDACTED, cookie: REDACTED });
    expect(out.url).toBe(`/api/files/1?sig=${REDACTED}&x=1`);
    expect(out.dsn).toBe(REDACTED);
    expect(String(out.note)).not.toMatch(/pa55word|eyJhbGci/);
    expect(out.passed).toBe(3);
  });
});

describe("error-reporting adapter", () => {
  it("never reports expected errors", async () => {
    expect(await reportError(new DomainError("validation", "bad"))).toEqual({ reported: false, reason: "expected" });
  });

  it("an unset DSN disables reporting without failing", async () => {
    delete process.env.ERROR_REPORTING_DSN;
    const restore = setLogSink(() => undefined);
    expect(await reportError(new Error("boom"))).toEqual({ reported: false, reason: "disabled" });
    restore();
  });

  it("posts a Sentry-compatible envelope with release, environment and tags, and no request data", async () => {
    process.env.ERROR_REPORTING_DSN = "https://pubkey@errors.example.test/77";
    process.env.RELEASE = "r-9";
    process.env.APP_ENV = "production";
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const restoreT = setErrorReportTransport(async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200 };
    });
    const restoreL = setLogSink(() => undefined);
    const r = await reportError(new Error("db timeout token=abcdefghijklmnopqrstuvwxyz"), { requestId: "req-12345678", module: "inventory", command: "inventory.movement.transfer", route: "/api/v1/x?secret=1" });
    restoreT();
    restoreL();
    expect(r.reported).toBe(true);
    expect(calls[0].url).toBe("https://errors.example.test/api/77/envelope/");
    expect(calls[0].headers["X-Sentry-Auth"]).toContain("sentry_key=pubkey");
    const event = JSON.parse(calls[0].body.split("\n")[2]);
    expect(event).toMatchObject({ release: "r-9", environment: "production", tags: { requestId: "req-12345678", module: "inventory", command: "inventory.movement.transfer", route: "/api/v1/x" } });
    expect(event.request).toBeUndefined();
    expect(calls[0].body).not.toMatch(/cookie|secret=1/i);
  });

  it("parses DSNs and builds events without request fields", () => {
    expect(parseDsn("https://k@sentry.io/123")).toEqual({ url: "https://sentry.io/api/123/envelope/", auth: expect.stringContaining("sentry_key=k") });
    expect(parseDsn("not a dsn")).toBeNull();
    const ev = buildErrorEvent(new Error("x"), {});
    expect(Object.keys(ev)).not.toContain("request");
  });
});
