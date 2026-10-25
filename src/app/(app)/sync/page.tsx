import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listMyConflicts, openConflictCount } from "@/lib/offline/server/conflicts";
import { REASON_LABEL, type SyncConflictReason } from "@/lib/offline/protocol";
import { fmtDateTime } from "@/lib/qty";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { SyncPanel } from "./sync-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sync and offline" };

/** US-7-06: this device's sync status, queue, offline data and registration; the person's own conflicts. */
export default async function SyncPage() {
  const ctx = await requireContext();
  const mine = await listMyConflicts(ctx, { openOnly: false });
  const canReview = ctx.can("platform.sync_conflict.view");
  const reviewCount = canReview ? await openConflictCount(ctx) : 0;
  return (
    <>
      <PageHeader
        title="Sync and offline"
        subtitle="What this device has queued, when it last reached the server, and the offline data it keeps for counting and weighing without signal."
        actions={canReview ? <LinkButton href="/sync/conflicts" variant="secondary">Conflict review{reviewCount ? ` · ${reviewCount}` : ""}</LinkButton> : undefined}
      />
      <div className="space-y-5">
        <SyncPanel userId={ctx.userId} sites={ctx.allowedSites} currentSiteId={ctx.currentSiteId} />
        <Card>
          <CardTitle>My changes that need review</CardTitle>
          {mine.length === 0 ? (
            <EmptyState title="Nothing to review">When the server cannot accept a change you made offline, it is listed here with the reason, and a supervisor decides what happens to it.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/sync/conflicts/${c.id}`} className="font-medium text-primary-text hover:underline">
                      {REASON_LABEL[c.reasonCode as SyncConflictReason] ?? c.reasonCode}
                      {c.relatedEntityNumber ? ` · ${c.relatedEntityNumber}` : ""}
                    </Link>
                    <p className="break-words text-[12px] text-muted">
                      {c.reasonMessage} · captured {fmtDateTime(c.clientCreatedAt)}
                    </p>
                  </div>
                  <Chip tone={c.status === "open" ? "warn" : "neu"}>{c.status === "open" ? "Waiting for review" : c.status.replace(/_/g, " ")}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
