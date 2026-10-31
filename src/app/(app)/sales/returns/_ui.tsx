import type { ReactNode } from "react";
import { Ban, CheckCircle2, CircleDashed, Hourglass, Lock, PackageCheck } from "lucide-react";
import { Chip } from "@/ui/status";

/** Customer return statuses in grade-5 words (ADR-088), each with an icon. Display only; the state machine is unchanged. */
const WORDS: Record<string, { tone: "neu" | "appr" | "info" | "q" | "ok"; label: string; icon: ReactNode }> = {
  draft: { tone: "neu", label: "Draft", icon: <CircleDashed size={13} aria-hidden /> },
  submitted: { tone: "appr", label: "Waiting for approval", icon: <Hourglass size={13} aria-hidden /> },
  approved: { tone: "info", label: "Approved: take it in", icon: <PackageCheck size={13} aria-hidden /> },
  received: { tone: "q", label: "Back in, waiting for QA check", icon: <Lock size={13} aria-hidden /> },
  inspected: { tone: "ok", label: "QA decided", icon: <CheckCircle2 size={13} aria-hidden /> },
  closed: { tone: "neu", label: "Done", icon: <CheckCircle2 size={13} aria-hidden /> },
  cancelled: { tone: "neu", label: "Cancelled", icon: <Ban size={13} aria-hidden /> },
};

export const returnWord = (status: string) => WORDS[status]?.label ?? status.replace(/_/g, " ");

export function ReturnStatusChip({ status }: { status: string; label?: string }) {
  const w = WORDS[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " "), icon: null };
  return (
    <Chip tone={w.tone}>
      {w.icon}
      {w.label}
    </Chip>
  );
}
