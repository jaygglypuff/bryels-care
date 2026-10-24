import { ListSkeleton } from "@/ui/states";

export default function Loading() {
  return <ListSkeleton label="approval rules" cards={3} />;
}
