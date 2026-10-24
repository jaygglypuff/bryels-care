import { COMPLAINT_STATUS_LABEL, type ComplaintStatus } from "@/modules/quality/complaints-rules";
import { Chip } from "@/ui/status";

const TONE = { open: "warn", investigating: "info", resolved: "appr", closed: "neu" } as const;

export function ComplaintStatusChip({ status }: { status: string }) {
  return <Chip tone={TONE[status as ComplaintStatus] ?? "neu"}>{COMPLAINT_STATUS_LABEL[status as ComplaintStatus] ?? status}</Chip>;
}

const MATCH_TONE = { verified: "ok", unverified: "neu", mismatch: "warn", not_given: "neu" } as const;
const MATCH_WORD = { verified: "Verified shipment", unverified: "Not verifiable", mismatch: "Not in shipments", not_given: "No code" } as const;

export function TraceMatchChip({ match }: { match: string }) {
  const k = match as keyof typeof MATCH_TONE;
  return <Chip tone={MATCH_TONE[k] ?? "neu"}>{MATCH_WORD[k] ?? match}</Chip>;
}
