/**
 * Plain words for the default adjustment reasons (usability test 2026-10-30, grade-5 reading level).
 * Only used while the company has not renamed the reason: a name changed in Master data → Reason codes
 * is shown as the company wrote it.
 */
const PLAIN: Record<string, string> = {
  found: "We found more than the system shows",
  lost: "Some is missing (we cannot find it)",
  damaged: "It is damaged",
  spillage: "It spilled",
  expired_disposal: "It expired and was thrown away",
  data_correction: "Data correction (administrators only)",
  opening_balance: "Opening balance (data migration, administrators only)",
  other: "Something else (tell us what)",
};

export function plainAdjustmentReason(code: string, label: string, defaultName: string | undefined): string {
  if (PLAIN[code] && (!defaultName || label === defaultName)) return PLAIN[code];
  return label;
}

export function adjustmentReasonWords(code: string): string {
  return PLAIN[code] ?? code.replace(/_/g, " ");
}
