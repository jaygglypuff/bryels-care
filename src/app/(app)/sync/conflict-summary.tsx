import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import { listConflicts, listMyConflicts } from "@/lib/offline/server/conflicts";
import { REASON_LABEL, commandLabel, type SyncConflictReason } from "@/lib/offline/protocol";
import { fmtDateTime } from "@/lib/qty";
import { Card, CardTitle, EmptyState, LinkButton } from "@/ui/core";
import { Chip } from "@/ui/status";

/** Action centre "Sync" tab (docs/ux-system.md 5.5, US-7-05): open conflicts for reviewers, else the person's own. */
export async function SyncConflictSummary({ ctx }: { ctx: AuthContext }) {
  const reviewer = ctx.can("platform.sync_conflict.view");
  const rows = (reviewer ? await listConflicts(ctx, { status: "open" }) : await listMyConflicts(ctx, { openOnly: true })).slice(0, 25);
  return (
    <Card>
      <CardTitle action={<LinkButton href={reviewer ? "/sync/conflicts" : "/sync"} variant="ghost" size="sm">{reviewer ? "Conflict queue" : "Sync"}</LinkButton>}>
        {reviewer ? "Offline changes waiting for review" : "Your offline changes waiting for review"}
      </CardTitle>
      {rows.length === 0 ? (
        <EmptyState title="Nothing to review">Changes made offline that the server could not apply appear here until someone resolves them.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <Link href={`/sync/conflicts/${c.id}`} className="text-[14px] font-medium text-primary-text hover:underline">
                  {commandLabel(c.commandType)}
                  {c.relatedEntityNumber ? ` · ${c.relatedEntityNumber}` : ""}
                </Link>
                <p className="break-words text-[12px] text-muted">
                  {c.userName} · {c.siteCode} · captured {fmtDateTime(c.clientCreatedAt)} · {c.reasonMessage}
                </p>
              </div>
              <Chip tone="bad">{REASON_LABEL[c.reasonCode as SyncConflictReason] ?? c.reasonCode}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
