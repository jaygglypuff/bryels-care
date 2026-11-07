import { requireContext } from "@/lib/auth/context";
import { PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { masterSearchAction } from "../../search-actions";
import { ScanClient } from "./scan-client";
import { ScanSearch } from "./scan-search";

export const metadata = { title: "Scan or search" };

/**
 * Scan or search (US-2-13, ADR-085) with the master search on top (owner request 2026-11-08): on phones the top-bar
 * Scan button opens this screen. Everyone may search (each result is checked on the server); scanning labels needs
 * stock access (inventory.lot.view).
 */
export default async function ScanPage({ searchParams }: { searchParams: Promise<{ code?: string; q?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const canScan = ctx.can("inventory.lot.view");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Scan or search" subtitle={ctx.currentSite.name} />
      <PageIntro>
        This screen is for finding anything fast: type a screen (“bills”), a name (“coconut oil”) or a number (“BILL-26-00001”, or just
        the last digits).
        {canScan ? " Or scan a label with the camera or scanner below." : ""}
      </PageIntro>
      <div className="space-y-4">
        <ScanSearch search={masterSearchAction} userId={ctx.userId} initialQuery={sp.q?.slice(0, 80) ?? ""} canScan={canScan} />
        {canScan ? (
          <section aria-labelledby="scan-a-label">
            <h2 id="scan-a-label" className="mb-2 mt-6 text-[15px] font-semibold">Scan a label</h2>
            <ScanClient code={sp.code?.slice(0, 200) ?? null} />
          </section>
        ) : (
          <p className="text-[13px] text-muted">Scanning labels needs stock access. Ask your manager if you need it.</p>
        )}
      </div>
    </div>
  );
}
