import { Chip } from "@/ui/status";

export function RevisionStatus({ status }: { status: string | null }) {
  if (!status) return <Chip tone="neu">No revision</Chip>;
  const tone = status === "approved" ? "ok" : status === "pending_approval" ? "appr" : status === "superseded" ? "exp" : "neu";
  return <Chip tone={tone}>{status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</Chip>;
}
