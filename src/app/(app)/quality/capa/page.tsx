import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listCapas } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { CapaStatusChip, exportLinkCls, filterLinkCls } from "./_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Open, in progress, verification"],
  ["verification", "Verification"],
  ["mine", "Mine"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

/** CAPA register (US-6-18, ux-system §9.14): source, owner, due date (overdue in danger), state. */
export default async function CapaListPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.capa.view")) return <Forbidden what="CAPA" />;
  const { status = "active" } = await searchParams;
  const rows = await listCapas(ctx, status === "mine" ? { status: "active", mine: true } : { status });
  const exportStatus = status === "mine" ? "active" : status;
  return (
    <>
      <PageHeader
        title="CAPA"
        subtitle="Corrective and preventive actions from deviations, complaints and audits; closure needs an effective check and a second person"
        actions={
          <>
            {ctx.can("quality.capa.create") && <LinkButton href="/quality/capa/new">Open CAPA</LinkButton>}
            <a className={exportLinkCls} href={`/api/v1/quality/capa/export?status=${exportStatus}&format=csv`}>
              Export CSV
            </a>
          </>
        }
      />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter CAPAs">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/quality/capa?status=${v}`} className={filterLinkCls(status === v)}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No CAPAs here" action={<LinkButton href="/quality/deviations" variant="secondary">Deviations</LinkButton>}>
            Open a CAPA from a deviation or complaint page, or for an audit finding.
          </EmptyState>
        ) : (
          <Table head={["CAPA", "State", "Source", "Title", "Owner", "Due", "Actions"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/quality/capa/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode}</div>
                </Td>
                <Td>
                  <CapaStatusChip status={r.status} />
                </Td>
                <Td>
                  {r.sourceLabel}
                  {r.sourceReference && <div className="text-[12px] text-muted">{r.sourceReference}</div>}
                </Td>
                <Td className="max-w-[280px]">{r.title}</Td>
                <Td>{r.ownerName}</Td>
                <Td className="whitespace-nowrap">
                  {r.dueDate ? fmtDate(r.dueDate) : "—"}
                  {r.overdue && (
                    <div className="mt-0.5">
                      <Chip tone="bad">Overdue</Chip>
                    </div>
                  )}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.openActions} open
                  {r.overdueActions > 0 && <div className="text-[12px] text-[var(--bad-fg)]">{r.overdueActions} overdue</div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
