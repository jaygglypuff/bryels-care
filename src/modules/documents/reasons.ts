/**
 * Reprint reasons (docs/reports-and-templates.md §13.3 "Reason codes": seed list for
 * `reason_codes.applies_to ∋ 'reprint'`). Configuration, not a rule: when the shared
 * `reason_codes` table lands, these become seeded rows and this list is read from it
 * (assumption A-W1E-03 in the stream report).
 */
export const REPRINT_REASONS = [
  { code: "lost_copy", label: "Lost copy", requiresNote: false },
  { code: "damaged_label", label: "Damaged or unreadable label", requiresNote: false },
  { code: "status_change", label: "Status changed (new status word needed)", requiresNote: false },
  { code: "repack", label: "Repacked into a new container", requiresNote: false },
  { code: "customer_copy", label: "Extra copy for a customer", requiresNote: false },
  { code: "other", label: "Other (explain)", requiresNote: true },
] as const;

export type ReprintReasonCode = (typeof REPRINT_REASONS)[number]["code"];

export function reprintReason(code: string) {
  return REPRINT_REASONS.find((r) => r.code === code) ?? null;
}
