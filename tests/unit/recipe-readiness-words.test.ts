import { describe, expect, it } from "vitest";
import { readiness, readinessSentence } from "@/modules/masterdata/recipe-readiness-words";

const ready = { kind: "ready" } as const;
const waitingNina = { kind: "waiting", by: "Nina (QA)" } as const;

describe("readinessSentence (ADR-116)", () => {
  it("is null when both parts are in use", () => {
    expect(readinessSentence(ready, ready)).toBeNull();
    expect(readiness(ready, ready)).toMatchObject({ ready: true, sentence: null });
  });

  it("names the part and the people (the owner's case: steps waiting)", () => {
    expect(readinessSentence(ready, waitingNina)).toBe("This product's steps are waiting for approval by Nina (QA) — it can be made after that.");
    expect(readinessSentence(waitingNina, ready)).toBe("This product's recipe is waiting for approval by Nina (QA) — it can be made after that.");
  });

  it("joins both parts when the same people decide them, else two clauses", () => {
    expect(readinessSentence(waitingNina, waitingNina)).toBe("This product's recipe and steps are waiting for approval by Nina (QA) — it can be made after that.");
    expect(readinessSentence(waitingNina, { kind: "draft", who: "Ana" })).toBe(
      "This product's recipe is waiting for approval by Nina (QA), and its steps are still a draft: Ana must finish them and send them for approval — it can be made after that.",
    );
    expect(readinessSentence({ kind: "draft", who: "you" }, { kind: "draft", who: "you" })).toBe("This product's recipe and steps are still a draft: you must finish them and send them for approval — it can be made after that.");
  });

  it("a later day ends with 'from that day'; nothing at all says what to do", () => {
    expect(readinessSentence({ kind: "later", from: "09 Nov 2026" }, ready)).toBe("This product's recipe can be used only from 09 Nov 2026 — it can be made from that day.");
    expect(readinessSentence(ready, { kind: "none" })).toBe("This product has no approved steps yet — it can be made after that.");
    expect(readinessSentence({ kind: "none" }, { kind: "none" })).toBe("This product has no approved recipe and steps yet: make its recipe and send it for approval — it can be made after that.");
    expect(readinessSentence({ kind: "none" }, waitingNina, "Calamansi Soap")).toBe("Calamansi Soap has no approved recipe yet, and its steps are waiting for approval by Nina (QA) — it can be made after that.");
  });
});
