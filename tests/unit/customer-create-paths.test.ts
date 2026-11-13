import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-133 item 7 (ADR-131 open point): the "Already a customer?" check runs in every create path of the app, not only
 * on the New customer screen. Every call of `createCustomer(` under src/app and src/modules (the definition aside)
 * must pass `duplicateCheck: true`. Test fixtures and seeds may call it without.
 */
const ROOT = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("customer create paths", () => {
  it("every createCustomer call in the app asks for the duplicate check", () => {
    const calls: { file: string; text: string }[] = [];
    for (const f of [...files(path.join(ROOT, "src/app")), ...files(path.join(ROOT, "src/modules"))]) {
      const src = readFileSync(f, "utf8");
      let i = src.indexOf("createCustomer(");
      while (i >= 0) {
        const before = src.slice(Math.max(0, i - 30), i);
        // Calls only (await / return), not the definition or a mention in a comment.
        if (/(await|return)\s+$/.test(before)) calls.push({ file: path.relative(ROOT, f), text: src.slice(i, i + 900) });
        i = src.indexOf("createCustomer(", i + 1);
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(2); // the screen and the customer import
    for (const c of calls) expect(c.text, c.file).toMatch(/duplicateCheck: true/);
  });
});
