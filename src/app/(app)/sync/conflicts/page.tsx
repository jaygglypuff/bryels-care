import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listConflicts } from "@/lib/offline/server/conflicts";
import { REASON_LABEL, commandLabel, type SyncConflictReason } from "@/lib/offline/protocol";
import { fmtDateTime } from "@/lib/qty";
import { Card, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sync conflicts" };

const TABS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
] as const;

/** US-7-05: the site's queue of offline changes the server could not accept. */
export default async function ConflictsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.sync_conflict.view")) return <Forbidden what="the sync conflict queue (your own conflicts are on the Sync page)" />;
  const { status: raw } = await searchParams;
  const status = TABS.some((t) => t.key === raw) ? (raw as (typeof TABS)[number]["key"]) : "open";
  const rows = await listConflicts(ctx, { status });
  return (
    <>
      <PageHeader
        title="Sync conflicts"
        subtitle="Offline changes the server could not apply as sent. Nothing here was applied; each one is kept, re-applied as a new change, discarded with a note or escalated."
        actions={<LinkButton href="/sync" variant="secondary">This device</LinkButton>}
      />
      <nav aria-label="Conflict status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/sync/conflicts?status=${t.key}`} aria-current={status === t.key ? "page" : undefined} className={cx("rounded-full border px-3.5 py-1.5 text-[13px]", status === t.key ? "border-primary bg-primary-soft font-semibold" : "border-line")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={status === "open" ? "No open conflicts" : "Nothing here"}>Changes from offline devices that need a decision appear here, newest first.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="conflict-list">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`/sync/conflicts/${c.id}`} className="font-medium text-primary-text hover:underline">
                    {commandLabel(c.commandType)}
                    {c.relatedEntityNumber ? ` · ${c.relatedEntityNumber}` : ""}
                  </Link>
                  <p className="break-words text-[13px] text-fg-2">{c.reasonMessage}</p>
                  <p className="text-[12px] text-muted">
                    {c.userName}
                    {c.deviceLabel ? ` on ${c.deviceLabel}` : " (unregistered browser)"} · captured {fmtDateTime(c.clientCreatedAt)} · site {c.siteCode}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Chip tone="bad">{REASON_LABEL[c.reasonCode as SyncConflictReason] ?? c.reasonCode}</Chip>
                  <Chip tone={c.status === "open" ? "warn" : "neu"}>{c.status === "open" ? "Open" : c.status.replace(/_/g, " ")}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
