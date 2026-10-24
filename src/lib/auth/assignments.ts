import { and, gt, isNull, lte, or, type SQL } from "drizzle-orm";
import { userSiteAssignments } from "@/db/schema";

/**
 * An assignment grants access while valid_from <= now < valid_to and it is not revoked
 * (docs/permissions-matrix.md §1.1 step 2, US-1-18). Every query that asks "who holds role X at
 * site S" must add this predicate; ended rows are kept for the audit trail and never deleted.
 */
export function activeAssignment(now: Date = new Date()): SQL {
  return and(
    isNull(userSiteAssignments.revokedAt),
    lte(userSiteAssignments.validFrom, now),
    or(isNull(userSiteAssignments.validTo), gt(userSiteAssignments.validTo, now)),
  )!;
}

/** `user_site_assignments.scope` (schema assignment_scope/v1, matrix §4.4). Absent key = whole site. */
export type AssignmentScope = { warehouseIds?: string[] };

export function parseScope(v: unknown): AssignmentScope | null {
  if (!v || typeof v !== "object") return null;
  const w = (v as { warehouseIds?: unknown }).warehouseIds;
  if (!Array.isArray(w)) return null;
  return { warehouseIds: w.filter((x): x is string => typeof x === "string") };
}
