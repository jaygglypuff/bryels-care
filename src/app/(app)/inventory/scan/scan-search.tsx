"use client";
import { useRouter } from "next/navigation";
import { MasterSearchPanel, type SearchFn } from "@/ui/master-search";

/** The master search on the Scan or search screen. A label typed or scanned into it opens its scan card below. */
export function ScanSearch({ search, userId, initialQuery, canScan }: { search: SearchFn; userId: string; initialQuery: string; canScan: boolean }) {
  const router = useRouter();
  return (
    <MasterSearchPanel
      search={search}
      userId={userId}
      variant="page"
      autoFocus
      initialQuery={initialQuery}
      onLabel={canScan ? (raw) => router.replace(`/inventory/scan?code=${encodeURIComponent(raw)}`, { scroll: false }) : undefined}
    />
  );
}
