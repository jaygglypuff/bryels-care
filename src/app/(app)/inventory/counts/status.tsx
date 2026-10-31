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

export function CountStatusChip({ status }: { status: string }) {
  return <Chip tone={TONE[status] ?? "neu"}>{COUNT_STATUS_LABEL[status] ?? status}</Chip>;
}

export const ADJ_STATUS_TONE: Record<string, "neu" | "info" | "warn" | "appr" | "ok" | "bad"> = {
  draft: "neu",
  submitted: "appr",
  approved: "info",
  rejected: "bad",
  posted: "ok",
  cancelled: "neu",
};

/** Adjustment statuses in plain words. */
export const ADJ_STATUS_LABEL: Record<string, string> = {
  draft: "Not finished",
  submitted: "Waiting for the manager",
  approved: "Approved, ready to save",
  rejected: "Not accepted",
  posted: "Saved to stock",
  cancelled: "Cancelled",
};

export function AdjustmentStatusChip({ status }: { status: string }) {
  return <Chip tone={ADJ_STATUS_TONE[status] ?? "neu"}>{ADJ_STATUS_LABEL[status] ?? status}</Chip>;
}
