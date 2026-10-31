import { COMPLAINT_STATUS_LABEL, type ComplaintStatus } from "@/modules/quality/complaints-rules";
import { AlertOctagon, CheckCircle2, Search } from "lucide-react";
import { Chip } from "@/ui/status";

const TONE = { open: "warn", investigating: "info", resolved: "appr", closed: "neu" } as const;
/** Grade-5 words (ADR-088); the stored states and the printed acknowledgement keep theirs. */
const WORD: Record<ComplaintStatus, string> = { open: "New – QA to look", investigating: "QA is looking into it", resolved: "Answered – to close", closed: "Closed" };
const ICON = { open: AlertOctagon, investigating: Search, resolved: CheckCircle2, closed: CheckCircle2 } as const;

export function ComplaintStatusChip({ status }: { status: string }) {
  const I = ICON[status as ComplaintStatus] ?? CheckCircle2;
  return (
    <Chip tone={TONE[status as ComplaintStatus] ?? "neu"}>
      <I size={13} aria-hidden />
      {WORD[status as ComplaintStatus] ?? COMPLAINT_STATUS_LABEL[status as ComplaintStatus] ?? status}
    </Chip>
  );
}

const MATCH_TONE = { verified: "ok", unverified: "neu", mismatch: "warn", not_given: "neu" } as const;
const MATCH_WORD = { verified: "We sent them this", unverified: "Cannot check", mismatch: "Not in what we sent them", not_given: "No label number" } as const;

export function TraceMatchChip({ match }: { match: string }) {
  const k = match as keyof typeof MATCH_TONE;
  return <Chip tone={MATCH_TONE[k] ?? "neu"}>{MATCH_WORD[k] ?? match}</Chip>;
}
