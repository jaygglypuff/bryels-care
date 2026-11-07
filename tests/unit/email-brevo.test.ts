/**
 * Owner 2026-11-08: "set up an email using Brevo for now". EMAIL_PROVIDER=brevo sends through Brevo's HTTPS
 * transactional API (Railway blocks outbound SMTP on small plans), never storing the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
vi.mock("@/db/client", () => ({ db: { insert: () => ({ values: async (v: Record<string, unknown>) => void inserted.push(v) }) } }));
vi.mock("@/db/schema", () => ({ emailOutbox: {} }));

const saved = { ...process.env };
beforeEach(() => {
  inserted.length = 0;
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.EMAIL_FROM = "Bryel's Care <noreply@bryels-care.example>";
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

describe("Brevo email", () => {
  it("is ready only with BREVO_API_KEY and EMAIL_FROM", async () => {
    const { emailSetupStatus } = await import("@/lib/email");
    expect(emailSetupStatus()).toEqual({ provider: "brevo", ready: true, problem: null });
    delete process.env.BREVO_API_KEY;
    expect(emailSetupStatus().ready).toBe(false);
    expect(emailSetupStatus().problem).toMatch(/BREVO_API_KEY/);
  });

  it("posts to Brevo with the api-key header, the parsed sender and plain text; stores no body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "<abc@smtp-relay.mailin.fr>" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendEmail } = await import("@/lib/email");
    const r = await sendEmail({ to: "ana@example.com", subject: "Hello", text: "Link: https://x/y?token=secret", template: "test" });
    expect(r).toEqual({ status: "sent", provider: "brevo" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { name: "Bryel's Care", email: "noreply@bryels-care.example" },
      to: [{ email: "ana@example.com" }],
      subject: "Hello",
      textContent: "Link: https://x/y?token=secret",
    });
    expect(inserted[0]).toMatchObject({ status: "sent", provider: "brevo", bodyText: null, providerMessageId: "<abc@smtp-relay.mailin.fr>" });
  });

  it("records a failed send without the key or the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), { status: 401 })));
    const { sendEmail } = await import("@/lib/email");
    const r = await sendEmail({ to: "ana@example.com", subject: "Hello", text: "secret body", template: "test" });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/401/);
    expect(JSON.stringify(inserted[0])).not.toMatch(/xkeysib-test|secret body/);
  });
});
