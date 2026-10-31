import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listHolds } from "@/modules/inventory/holds";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { HoldChip } from "../_ui";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Stopped by QA" };

const TABS = [
  ["active", "Stopped now"],
  ["closed", "No longer stopped"],
  ["", "All"],
] as const;

export default async function HoldsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.hold.view")) return <Forbidden what="QA holds" />;
  const { status = "active" } = await searchParams;
  const rows = await listHolds(ctx, { status: status || undefined });
  return (
    <>
      <PageHeader
        title="Stopped by QA"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {ctx.can("quality.hold.create") && <LinkButton href="/quality/holds/new" variant="cta">Stop a lot</LinkButton>}
            {ctx.can("inventory.held_stock_issue.approve") && (
              <MoreMenu>
                <LinkButton href="/quality/holds/issue" variant="secondary">
                  Take out stopped stock (exception)
                </LinkButton>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for QA: lots or places that QA stopped. Nobody can use, set aside or ship them until a second QA person lets them go.</PageIntro>
      <FilterTabs label="Filter" active={status} tabs={TABS.map(([v, t]) => [v, t, `/quality/holds?status=${v}`] as const)} />
      {rows.length === 0 ? (
        <EmptyState title={status === "active" ? "Nothing is stopped right now" : "Nothing here"} action={ctx.can("quality.hold.create") ? <LinkButton href="/quality/holds/new">Stop a lot</LinkButton> : undefined}>
          When QA stops a lot or a place at this site, it is listed here. Only QA can stop or let go; ask the QA lead.
        </EmptyState>
      ) : (
        <PlainList label="Stopped by QA">
          {rows.map((h) => (
            <PlainRow
              key={h.id}
              href={`/quality/holds/${h.id}`}
              title={h.reason}
              code={h.holdNumber}
              status={<HoldChip status={h.status} />}
              facts={
                <>
                  {h.lotNumber ? `Lot ${h.lotNumber}` : `Place ${h.locationCode}`} · {h.lotCount} lot(s) · {h.openedByName}, {fmtDateTime(h.openedAt)}
                  {h.resolution ? ` · ${h.resolution === "released" ? "made OK again" : "not OK"}` : ""}
                </>
              }
            />
          ))}
        </PlainList>
      )}
    </>
  );
}
