import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { resetTestDatabase } from "../../support/db";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

beforeAll(async () => {
  await resetTestDatabase();
}, 180_000);

describe("W1D custom SQL is part of the normal migrate path", () => {
  it("the custom migration is a verbatim copy of src/db/sql/w1d.sql (no drift)", () => {
    const migration = read("src/db/migrations/0002_w1d_custom_sql.sql");
    const canonical = read("src/db/sql/w1d.sql");
    expect(migration.endsWith(canonical)).toBe(true);
    const journal = JSON.parse(read("src/db/migrations/meta/_journal.json")) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain("0002_w1d_custom_sql");
  });

  it("pnpm db:migrate installs the triggers and exclusion constraints", async () => {
    const triggers = await db.execute<{ tgname: string }>(sql`select tgname from pg_trigger where not tgisinternal and tgname like 'tg_%' order by tgname`);
    const names = triggers.map((t) => t.tgname);
    for (const t of [
      "tg_bom_lines_parent_draft",
      "tg_routing_steps_parent_draft",
      "tg_routing_step_parameters_parent_draft",
      "tg_routing_step_checklist_items_parent_draft",
      "tg_inspection_plan_tests_parent_draft",
      "tg_formula_revisions_immutable",
      "tg_routing_revisions_immutable",
      "tg_work_instruction_revisions_immutable",
      "tg_inspection_plans_immutable",
      "tg_approval_decisions_append_only",
      "tg_equipment_state_transitions_append_only",
      "tg_batches_freeze_revisions",
    ]) {
      expect(names).toContain(t);
    }
    const ex = await db.execute<{ conname: string }>(sql`select conname from pg_constraint where contype = 'x' order by conname`);
    expect(ex.map((c) => c.conname)).toEqual(["formula_rev_no_overlap_ex", "inspection_plans_no_overlap_ex", "routing_rev_no_overlap_ex", "wi_rev_no_overlap_ex"]);
  });
});
