import "server-only";
import type { DbOrTx } from "@/db/client";
import { getSetting } from "@/lib/settings";

/**
 * ADR-126 (A-SCAN-TYPED-01): whether a typed label number counts as a verification check in this organisation
 * (setting `scan.typed_code_counts_as_check`, default on). Read by every check service (second check, boxing check,
 * label check, lot confirmation at weighing and Get materials) and passed to `checkEntryMode` / `confirmLot`; read
 * again on offline replay, so a weighing queued while typing was allowed is refused if typing is now off.
 */
export function typedChecksAllowed(q: DbOrTx, organizationId: string): Promise<boolean> {
  return getSetting(q, organizationId, "scan.typed_code_counts_as_check");
}
