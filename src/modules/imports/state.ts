import { DomainError } from "@/lib/errors";
import type { IMPORT_JOB_STATUSES } from "@/db/schema";

/**
 * Import job state machine (docs/data-migration-plan.md §9.1, docs/data-model.md §3.10):
 *
 *   uploaded → validating → validated | under_review (tier 2/3 decisions pending) | failed
 *   under_review → validated (all decided)            validated | under_review | failed → uploaded (mapping changed)
 *   validated → submitted → approved → posting → posted → voided
 *   submitted → validated (returned for changes)      posting → failed → posting (resume) | validating
 *   uploaded | validated | under_review | submitted | approved | failed → rejected
 *
 * Every transition writes one `platform.import_job.<event>` audit event (src/modules/imports/service.ts).
 */
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_JOB_TRANSITIONS: Record<ImportJobStatus, readonly ImportJobStatus[]> = {
  uploaded: ["validating", "rejected"],
  validating: ["validated", "under_review", "failed"],
  validated: ["uploaded", "validating", "submitted", "rejected"],
  under_review: ["uploaded", "validating", "validated", "rejected"],
  submitted: ["validated", "approved", "rejected"],
  approved: ["posting", "rejected"],
  posting: ["posted", "failed"],
  failed: ["uploaded", "validating", "posting", "rejected"],
  posted: ["voided"],
  rejected: [],
  voided: [],
};

export const IMPORT_STATUS_LABELS: Record<ImportJobStatus, string> = {
  uploaded: "Uploaded: map the columns",
  validating: "Validating…",
  validated: "Validated",
  under_review: "Needs duplicate decisions",
  submitted: "Waiting for approval",
  approved: "Approved: ready to post",
  posting: "Posting…",
  posted: "Posted",
  failed: "Failed",
  rejected: "Rejected",
  voided: "Voided (reversed)",
};

export function canTransition(from: ImportJobStatus, to: ImportJobStatus): boolean {
  return (IMPORT_JOB_TRANSITIONS[from] ?? []).includes(to);
}

export function assertImportTransition(from: string, to: ImportJobStatus, label: string): void {
  if (!canTransition(from as ImportJobStatus, to)) {
    throw new DomainError("state", `Import ${label} is ${IMPORT_STATUS_LABELS[from as ImportJobStatus]?.toLowerCase() ?? from}; it cannot move to "${IMPORT_STATUS_LABELS[to].toLowerCase()}".`, { from, to });
  }
}
