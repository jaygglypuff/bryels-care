import type { ReactNode } from "react";
import { Ban, CheckCircle2, CircleDashed, Loader2, Printer, Trash2, XCircle } from "lucide-react";
import { Chip } from "@/ui/status";

const JOB: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "neu"; label: string; icon: ReactNode }> = {
  queued: { tone: "neu", label: "Waiting", icon: <CircleDashed size={13} aria-hidden /> },
  rendering: { tone: "info", label: "Getting ready", icon: <Loader2 size={13} aria-hidden /> },
  ready: { tone: "info", label: "Ready to print", icon: <Printer size={13} aria-hidden /> },
  printed: { tone: "ok", label: "Printed", icon: <CheckCircle2 size={13} aria-hidden /> },
  failed: { tone: "bad", label: "Did not print", icon: <XCircle size={13} aria-hidden /> },
  cancelled: { tone: "neu", label: "Cancelled", icon: <Ban size={13} aria-hidden /> },
};

/** Label job status with icon + words + tone (never colour alone). Voided printed labels say "Old label: throw away". */
export function JobStatus({ status, voided }: { status: string; voided?: boolean }) {
  if (voided)
    return (
      <Chip tone="bad">
        <Trash2 size={13} aria-hidden /> Old label: throw away
      </Chip>
    );
  const s = JOB[status] ?? { tone: "neu" as const, label: status, icon: null };
  return (
    <Chip tone={s.tone}>
      {s.icon}
      {s.label}
    </Chip>
  );
}

/** The word printed on the label for the lot's QA state (label templates print these; kept as on paper). */
export const STATUS_AT_PRINT: Record<string, string> = { quarantine: "QUARANTINE", released: "RELEASED", on_hold: "ON HOLD", rejected: "REJECTED", expired: "EXPIRED", recalled: "RECALLED" };

/** The same state in plain words for the screen (grade-5, ADR-088). */
export const STATE_WORDS: Record<string, string> = { quarantine: "waiting for QA check", released: "ready to use", on_hold: "stopped by QA", rejected: "rejected", expired: "expired", recalled: "recalled" };

export function shortRef(id: string) {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
