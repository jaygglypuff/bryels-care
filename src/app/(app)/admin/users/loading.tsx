import { ListSkeleton } from "@/ui/states";

export default function Loading() {
  return <ListSkeleton label="users" cards={2} />;
}
