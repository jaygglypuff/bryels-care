/** Job registry rules (docs/architecture.md §8): code pattern, uniqueness, listed in the registry table. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JOB_CODE_RE, createJobRegistry, defineJob } from "@/modules/platform/job-definition";
import { JOB_DEFINITIONS } from "@/modules/platform/job-handlers";
import { summarizePayload } from "@/modules/platform/jobs";

const architecture = readFileSync(path.resolve(__dirname, "../../docs/architecture.md"), "utf8");

describe("job registry", () => {
  it("every registered job is listed in the docs/architecture.md §8 table", () => {
    for (const d of JOB_DEFINITIONS) {
      expect(JOB_CODE_RE.test(d.code), d.code).toBe(true);
      expect(architecture, `${d.code} missing from architecture §8`).toContain(`| \`${d.code}\` |`);
    }
  });

  it("codes are unique and malformed codes are refused at definition time", () => {
    expect(() => createJobRegistry(JOB_DEFINITIONS)).not.toThrow();
    expect(() => createJobRegistry([...JOB_DEFINITIONS, JOB_DEFINITIONS[0]])).toThrow(/twice/);
    const base = { title: "t", description: "d", payload: z.object({}).strict(), keyTuple: () => [], run: async () => ({}) };
    expect(() => defineJob({ ...base, code: "Inventory.Reconcile" })).toThrow();
    expect(() => defineJob({ ...base, code: "noModule" })).toThrow();
    expect(defineJob({ ...base, code: "platform.some_job" }).code).toBe("platform.some_job");
  });

  it("scheduled jobs declare a timezone and the permissions their system context needs", () => {
    for (const d of JOB_DEFINITIONS.filter((d) => d.schedule)) {
      expect(d.schedule!.tz).toBeTruthy();
      expect(d.systemPermissions?.length, d.code).toBeGreaterThan(0);
    }
  });

  it("payload summaries mask secret-like keys and cut long values", () => {
    expect(summarizePayload({ password: "x", apiKey: "y", nested: { sessionToken: "z", ok: "fine" }, long: "a".repeat(200) })).toEqual({
      password: "•••",
      apiKey: "•••",
      nested: { sessionToken: "•••", ok: "fine" },
      long: "a".repeat(117) + "…",
    });
  });
});
