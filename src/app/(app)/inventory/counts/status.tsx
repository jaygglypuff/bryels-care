import type { ReactNode } from "react";
import { Ban, CheckCircle2, CircleDashed, ClipboardList, Lock, PauseCircle, RotateCcw, XCircle } from "lucide-react";
import { Chip } from "@/ui/status";

/** Count statuses in plain words (usability test 2026-10-30; the stored codes are unchanged). */
export const COUNT_STATUS_LABEL: Record<string, string> = {
  planned: "Not started",
  in_progress: "Counting now (shelves locked)",
  counted: "Counted, waiting for the manager",
  recount: "Count again",
  pending_approval: "Waiting for a second OK",
  approved: "Approved, ready to save",
  posted: "Saved to stock",
  cancelled: "Cancelled",
};

const TONE: Record<string, "neu" | "info" | "warn" | "appr" | "ok"> = {
  planned: "neu",
  in_progress: "info",
  counted: "appr",
  recount: "warn",
  pending_approval: "appr",
  approved: "appr",
  posted: "ok",
  cancelled: "neu",
};

/** Icons so a state is never told by colour alone (ADR-088). */
const ICON: Record<string, ReactNode> = {
  planned: <CircleDashed size={13} aria-hidden />,
  in_progress: <Lock size={13} aria-hidden />,
  counted: <ClipboardList size={13} aria-hidden />,
  recount: <RotateCcw size={13} aria-hidden />,
  pending_approval: <PauseCircle size={13} aria-hidden />,
  approved: <CheckCircle2 size={13} aria-hidden />,
  posted: <CheckCircle2 size={13} aria-hidden />,
  cancelled: <Ban size={13} aria-hidden />,
  draft: <CircleDashed size={13} aria-hidden />,
  submitted: <PauseCircle size={13} aria-hidden />,
  rejected: <XCircle size={13} aria-hidden />,
};

export function CountStatusChip({ status }: { status: string }) {
  return (
    <Chip tone={TONE[status] ?? "neu"}>
      {ICON[status]}
      {COUNT_STATUS_LABEL[status] ?? status}
    </Chip>
  );
}

export const ADJ_STATUS_TONE: Record<string, "neu" | "info" | "warn" | "appr" | "ok" | "bad"> = {
  draft: "neu",
  submitted: "appr",
  approved: "info",
  rejected: "bad",
  posted: "ok",
  cancelled: "neu",
};

/** Stock-fix (adjustment) statuses in plain words. */
export const ADJ_STATUS_LABEL: Record<string, string> = {
  draft: "Not finished",
  submitted: "Waiting for the manager",
  approved: "Approved, ready to save",
  rejected: "Not accepted",
  posted: "Saved to stock",
  cancelled: "Cancelled",
};

export function AdjustmentStatusChip({ status }: { status: string }) {
  return (
    <Chip tone={ADJ_STATUS_TONE[status] ?? "neu"}>
      {ICON[status]}
      {ADJ_STATUS_LABEL[status] ?? status}
    </Chip>
  );
}
