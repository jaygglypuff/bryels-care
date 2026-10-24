import { Chip } from "@/ui/status";

const TONE = { draft: "neu", submitted: "appr", approved: "info", received: "q", inspected: "ok", closed: "neu", cancelled: "neu" } as const;

export function ReturnStatusChip({ status, label }: { status: string; label?: string }) {
  return <Chip tone={TONE[status as keyof typeof TONE] ?? "neu"}>{label ?? status}</Chip>;
}
