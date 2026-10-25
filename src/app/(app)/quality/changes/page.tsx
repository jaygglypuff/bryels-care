import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { listChangeControls } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ChangeStatusChip, filterLinkCls } from "../capa/_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Open"],
  ["submitted", "Under review"],
  ["approved", "Approved, to implement"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

/** Change control register (US-6-18): proposals to change formula, routing, inspection-plan or work-instruction revisions. */
export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.change_control.view")) return <Forbidden what="change control" />;
  const { status = "active" } = await searchParams;
  const rows = await listChangeControls(ctx, { status });
  return (
    <>
      <PageHeader
        title="Change control"
        subtitle="Proposed changes with impact assessment and approval; the change itself is made through the record's own revision workflow"
        actions={ctx.can("quality.change_control.create") ? <LinkButton href="/quality/changes/new">Propose a change</LinkButton> : undefined}
      />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter changes">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/quality/changes?status=${v}`} className={filterLinkCls(status === v)}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No change controls here">Propose a change before revising a formula, routing or inspection plan; QA approves it, then the revision follows its own approval.</EmptyState>
        ) : (
          <Table head={["Change", "State", "What changes", "Title", "Risk", "Target", "Proposed"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/quality/changes/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode ?? "Organization"}</div>
                </Td>
                <Td>
                  <ChangeStatusChip status={r.status} />
                </Td>
                <Td>
                  {r.entityTypeLabel}
                  {r.entityLabel && <div className="text-[12px] text-muted">{r.entityLabel}</div>}
                </Td>
                <Td className="max-w-[280px]">{r.title}</Td>
                <Td>{r.riskLevel ?? <span className="text-muted">—</span>}</Td>
                <Td className="whitespace-nowrap">{r.targetDate ? fmtDate(r.targetDate) : "—"}</Td>
                <Td className="whitespace-nowrap">
                  {fmtDateTime(r.createdAt)}
                  <div className="text-[12px] text-muted">{r.createdByName}</div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
