import Link from "next/link";
import { Help } from "@/ui/help/help";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { COUNT_KINDS } from "@/db/schema";
import { eligibleCounters, listCounts } from "@/modules/inventory/counts";
import { listSiteLocations } from "@/modules/inventory/moves";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { PlanCountForm } from "./count-forms";
import { COUNT_STATUS_LABEL, CountStatusChip } from "./status";

export const metadata = { title: "Stock counts" };

/** Stock counts (grade-5, ADR-088): what is being counted first, the count number small and grey. */
export default async function CountsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.stock_count.view")) return <Forbidden what="stock counts" />;
  const sp = await searchParams;
  const counts = await listCounts(ctx);
  const canPlan = ctx.can("inventory.stock_count.create") && ctx.can("masterdata.location.view");
  const [locations, counters] = canPlan && sp.new ? await Promise.all([listSiteLocations(ctx), eligibleCounters(ctx)]) : [[], []];
  const active = counts.filter((c) => !["posted", "cancelled"].includes(c.status));
  const done = counts.filter((c) => ["posted", "cancelled"].includes(c.status));
  const row = (c: (typeof counts)[number]) => (
    <PlainRow
      key={c.id}
      href={`/inventory/counts/${c.id}`}
      title={`${c.locations} ${c.locations === 1 ? "shelf" : "shelves"}${c.countKind === "full" ? " (everything)" : ""}`}
      status={<CountStatusChip status={c.status} />}
      facts={
        <>
          {c.scheduledFor ? fmtDate(c.scheduledFor) : fmtDate(c.createdAt)} · planned by {c.createdBy}
          {c.isBlind ? " · counters do not see the expected amount" : ""}
        </>
      }
      code={c.countNumber}
      tone={c.status === "recount" ? "warn" : undefined}
    />
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock counts"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {canPlan && !sp.new ? <LinkButton href="/inventory/counts?new=1" variant="cta">Plan a count</LinkButton> : null}
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <Help screen="inventory.count" />
                <p className="text-[13px] text-fg-2">Steps: {Object.values(COUNT_STATUS_LABEL).join(" → ")}.</p>
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for counting what is really on the shelves. While a count runs, nobody can move stock on its shelves; a manager checks the differences before stock is changed.</PageIntro>
      {canPlan && sp.new && (
        <Card>
          <CardTitle action={<Link href="/inventory/counts" className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">Close</Link>}>Plan a count</CardTitle>
          <PlanCountForm locations={locations} counters={counters} kinds={COUNT_KINDS} />
        </Card>
      )}
      {counts.length === 0 ? (
        <EmptyState title="No counts yet" action={canPlan && !sp.new ? <LinkButton href="/inventory/counts?new=1" variant="cta">Plan a count</LinkButton> : undefined}>
          {canPlan ? "Plan a count of a few shelves to start. Counting a few shelves every week keeps stock right." : "Counts planned by your site manager show here. Ask them if you were told to count."}
        </EmptyState>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-[16px] font-semibold">Open counts · {active.length}</h2>
            {active.length === 0 ? <p className="text-[14px] text-fg-2">No count is open. Nothing to do.</p> : <PlainList label="Open counts">{active.map(row)}</PlainList>}
          </section>
          {done.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[16px] font-semibold">Finished · {done.length}</h2>
              <PlainList label="Finished counts">{done.map(row)}</PlainList>
            </section>
          )}
        </>
      )}
    </div>
  );
}
