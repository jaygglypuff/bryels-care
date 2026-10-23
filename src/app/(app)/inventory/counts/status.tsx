import { Chip } from "@/ui/status";

export const COUNT_STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  in_progress: "Counting (frozen)",
  counted: "Counted",
  recount: "Recount",
  pending_approval: "Second approval",
  approved: "Approved",
  posted: "Posted",
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
