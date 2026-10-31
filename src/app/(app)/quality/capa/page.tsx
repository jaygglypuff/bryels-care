import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listCapas } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { CapaStatusChip, exportLinkCls } from "./_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Not done"],
  ["verification", "Checking the fix"],
  ["mine", "Mine"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

/** CAPA register (US-6-18, ux-system §9.14): source, owner, due date (overdue in danger), state. */
export default async function CapaListPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.capa.view")) return <Forbidden what="fix-and-prevent plans" />;
  const { status = "active" } = await searchParams;
  const rows = await listCapas(ctx, status === "mine" ? { status: "active", mine: true } : { status });
  const exportStatus = status === "mine" ? "active" : status;
  return (
    <>
      <PageHeader
        title="Fix-and-prevent plans"
        actions={
          <>
            {ctx.can("quality.capa.create") && <LinkButton href="/quality/capa/new" variant="cta">Start a plan</LinkButton>}
            <MoreMenu>
              <a className={exportLinkCls} href={`/api/v1/quality/capa/export?status=${exportStatus}&format=csv`}>
                Download (CSV)
              </a>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for QA and managers: when something went wrong, plan what to fix now and what to change so it does not happen again (in QA language: CAPA).</PageIntro>
      <Card>
        <FilterTabs label="Filter plans" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/quality/capa?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No plans here" action={<LinkButton href="/quality/deviations" variant="secondary">Problem reports</LinkButton>}>
            Start a plan from a problem report or a complaint (⋯ More there), or with “Start a plan” for an audit finding. Questions? Ask the QA lead.
          </EmptyState>
        ) : (
          <PlainList label="Fix-and-prevent plans">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                href={`/quality/capa/${r.id}`}
                title={r.title}
                code={r.number}
                tone={r.overdue ? "bad" : undefined}
                status={
                  <>
                    <CapaStatusChip status={r.status} />
                    {r.overdue && <Chip tone="bad">Late</Chip>}
                  </>
                }
                facts={
                  <>
                    {r.ownerName} · {r.dueDate ? `by ${fmtDate(r.dueDate)}` : "no date"} · {r.openActions} thing(s) to do{r.overdueActions > 0 ? `, ${r.overdueActions} late` : ""} · from {r.sourceLabel === "Deviation" ? "problem report" : r.sourceLabel.toLowerCase()} {r.sourceReference ?? ""}
                  </>
                }
              />
            ))}
          </PlainList>
        )}
      </Card>
    </>
  );
}
