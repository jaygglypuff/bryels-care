import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { COUNT_KINDS } from "@/db/schema";
import { eligibleCounters, listCounts } from "@/modules/inventory/counts";
import { listSiteLocations } from "@/modules/inventory/moves";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { PlanCountForm } from "./count-forms";
import { COUNT_STATUS_LABEL, CountStatusChip } from "./status";

export const metadata = { title: "Stock counts" };

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.stock_count.view")) return <Forbidden what="stock counts" />;
  const sp = await searchParams;
  const counts = await listCounts(ctx);
  const canPlan = ctx.can("inventory.stock_count.create") && ctx.can("masterdata.location.view");
  const [locations, counters] = canPlan && sp.new ? await Promise.all([listSiteLocations(ctx), eligibleCounters(ctx)]) : [[], []];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock counts"
        subtitle={`${ctx.currentSite.code} · plan blind cycle or full counts; released counts freeze their locations until posted or cancelled`}
        actions={canPlan && !sp.new ? <Link href="/inventory/counts?new=1" className="inline-flex min-h-[44px] items-center rounded-full bg-cta px-5 text-[14px] font-medium text-white">Plan a count</Link> : undefined}
      />
      {canPlan && sp.new && (
        <Card>
          <CardTitle action={<Link href="/inventory/counts" className="text-[13px] text-primary-text hover:underline">Close</Link>}>Plan a count</CardTitle>
          <PlanCountForm locations={locations} counters={counters} kinds={COUNT_KINDS} />
        </Card>
      )}
      <Card>
        {counts.length === 0 ? (
          <EmptyState title="No counts yet">{canPlan ? "Plan a cycle count of a few locations to start." : "Counts planned by your site manager appear here."}</EmptyState>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {counts.map((c) => (
                <li key={c.id}>
                  <Link href={`/inventory/counts/${c.id}`} className="block rounded-[12px] border border-line p-3">
                    <div className="flex items-start justify-between gap-2"><span className="font-mono font-semibold text-primary-text">{c.countNumber}</span><CountStatusChip status={c.status} /></div>
                    <p className="mt-1 text-[13px]">{c.countKind} · {c.locations} location(s){c.isBlind ? " · blind" : ""}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block" head={["Count", "Kind", "Locations", "Lines", "Scheduled", "Planned by", "Status"]}>
              {counts.map((c) => (
                <tr key={c.id}>
                  <Td><Link href={`/inventory/counts/${c.id}`} className="font-mono font-semibold text-primary-text hover:underline">{c.countNumber}</Link></Td>
                  <Td>{c.countKind}{c.isBlind ? <> <Chip>blind</Chip></> : null}</Td>
                  <Td>{c.locations}</Td>
                  <Td>{c.lines}</Td>
                  <Td>{fmtDate(c.scheduledFor)}</Td>
                  <Td>{c.createdBy}</Td>
                  <Td><CountStatusChip status={c.status} /></Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
      <p className="text-[12px] text-muted">Statuses: {Object.values(COUNT_STATUS_LABEL).join(" → ")}.</p>
    </div>
  );
}
