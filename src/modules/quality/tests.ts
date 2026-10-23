import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, testResults } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { TESTABLE_BATCH_STATUSES } from "./rules";

export type RecordTestResultInput = { batchId: string; testName: string; specification: string; result: string; passed: boolean };

function required(v: string, field: string, label: string, max = 200) {
  const s = (v ?? "").trim();
  if (!s) throw new DomainError("validation", `${label} is required.`, { field });
  if (s.length > max) throw new DomainError("validation", `${label} is too long (max ${max} characters).`, { field });
  return s;
}

/**
 * Appends a QC test result to a batch (results are append-only; there is no edit or delete).
 * The specification text is entered by QA; the system does not define product specifications.
 */
export async function recordTestResult(ctx: AuthContext, input: RecordTestResultInput) {
  ctx.require("quality.test_result.create");
  const testName = required(input.testName, "testName", "Test name", 120);
  const specification = required(input.specification, "specification", "Specification");
  const result = required(input.result, "result", "Result");
  if (typeof input.passed !== "boolean") throw new DomainError("validation", "Choose pass or fail.", { field: "passed" });
  if (!/^[0-9a-f-]{36}$/i.test(input.batchId)) throw new DomainError("not_found", "Batch not found.");

  return db.transaction(async (tx) => {
    // Lock the batch so a result cannot slip in while the batch is being released.
    const [batch] = await tx
      .select({ id: batches.id, siteId: batches.siteId, status: batches.status, batchNumber: batches.batchNumber })
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);
    if (!batch) throw new DomainError("not_found", "Batch not found.");
    ctx.requireSite(batch.siteId);
    if (!(TESTABLE_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
      throw new DomainError("state", `Test results can only be recorded while the batch is in process or awaiting QC (it is ${batch.status.replace("_", " ")}).`);
    }
    const [row] = await tx
      .insert(testResults)
      .values({ batchId: batch.id, testName, specification, result, passed: input.passed, testedBy: ctx.userId })
      .returning();
    await audit(tx, ctx, {
      action: "quality.test_result.recorded",
      entityType: "test_result",
      entityId: row.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      after: { batchId: batch.id, testName, specification, result, passed: input.passed },
    });
    return row;
  });
}
