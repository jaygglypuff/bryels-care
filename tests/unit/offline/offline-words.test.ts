/**
 * ADR-134 item 3: when a save cannot reach the server, the screen says so in plain words (nothing was saved; on the
 * floor, write it on the paper batch record and type it in later) instead of an error page. Real server errors are
 * not hidden behind that sentence.
 */
import { describe, expect, it } from "vitest";
import type { ActionState } from "@/lib/errors";
import { NO_INTERNET_SAVE, isNoConnection, noInternetState, withNoInternet } from "@/lib/offline/words";

describe("no-internet message for forms (ADR-134)", () => {
  it("recognises a lost connection", () => {
    expect(isNoConnection(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isNoConnection(new TypeError("Load failed"), true)).toBe(true);
    expect(isNoConnection(new TypeError("NetworkError when attempting to fetch resource."), true)).toBe(true);
    expect(isNoConnection(new Error("anything"), false)).toBe(true);
  });

  it("does not hide a server error", () => {
    expect(isNoConnection(new Error("An unexpected response was received from the server."), true)).toBe(false);
    expect(isNoConnection(new Error("Internal error"), true)).toBe(false);
  });

  it("says nothing was saved and what to do, in plain words", () => {
    const s = noInternetState();
    expect(s).toMatchObject({ ok: false, tone: "warn" });
    expect(s?.message).toBe(NO_INTERNET_SAVE);
    expect(NO_INTERNET_SAVE).toMatch(/Nothing was saved/);
    expect(NO_INTERNET_SAVE).toMatch(/paper batch record/);
  });

  it("a wrapped form action answers in words when the request cannot be sent, and passes real answers through", async () => {
    const lost = withNoInternet<ActionState>(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await lost(null, new FormData())).toMatchObject({ ok: false, message: NO_INTERNET_SAVE });
    const fine = withNoInternet<ActionState>(async () => ({ ok: true, message: "Saved." }));
    expect(await fine(null, new FormData())).toEqual({ ok: true, message: "Saved." });
    const broken = withNoInternet<ActionState>(async () => Promise.reject(new Error("Internal error")));
    await expect(broken(null, new FormData())).rejects.toThrow("Internal error");
  });
});
