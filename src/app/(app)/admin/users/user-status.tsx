import { Chip } from "@/ui/status";

const TEXT: Record<string, string> = { invited: "Not signed in yet", active: "Active", locked: "Locked", deactivated: "Switched off" };

/** Account status chip: invited | active | locked | deactivated (text label, not colour alone; grade-5 words). */
export function UserStatusChip({ status }: { status: string }) {
  const tone = status === "active" ? "ok" : status === "locked" ? "bad" : status === "invited" ? "info" : "neu";
  return <Chip tone={tone}>{TEXT[status] ?? status}</Chip>;
}
