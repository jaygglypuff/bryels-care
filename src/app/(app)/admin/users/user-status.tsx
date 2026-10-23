import { Chip } from "@/ui/status";

/** Account status chip: invited | active | locked | deactivated (text label, not colour alone). */
export function UserStatusChip({ status }: { status: string }) {
  const tone = status === "active" ? "ok" : status === "locked" ? "bad" : status === "invited" ? "info" : "neu";
  return <Chip tone={tone}>{status.charAt(0).toUpperCase() + status.slice(1)}</Chip>;
}
