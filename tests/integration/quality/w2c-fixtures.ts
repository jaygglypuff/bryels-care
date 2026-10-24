import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { asUser, type Kit } from "../../support/kit";
import { runSoapBatchToQuarantine } from "../../support/w2b";

/**
 * W2C fixture: an Acapulco Soap batch run through every W2B execution service (clearances, weighings,
 * steps, packaging, yield, post to quarantine), so it freezes the QA-approved finished-product plan
 * IP-ACS-FP and its quarantined output lot is posted the real way. `units` is the counted output.
 */
export async function awaitingQcBatch(kit: Kit, manager: AuthContext, units = 62) {
  const operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  const checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  const r = await runSoapBatchToQuarantine(kit, { manager, operator, checker, plannedSizeKg: "8.8", units: String(units) });
  const [b] = await db.select({ inspectionPlanId: batches.inspectionPlanId }).from(batches).where(eq(batches.id, r.batchId));
  return { batchId: r.batchId, batchNumber: r.batchNumber, lotId: r.lotId, lotNumber: r.lotNumber, inspectionPlanId: b.inspectionPlanId };
}
