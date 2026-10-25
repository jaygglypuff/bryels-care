import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listRecallCases } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { RecallStatusChip, filterLinkCls } from "../capa/_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Open"],
  ["submitted", "Awaiting approval"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

/** Recall cases (US-6-18, ux-system §9.14): recalls, withdrawals and mock recall drills. */
export default async function RecallCasesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.recall_case.view")) return <Forbidden what="recall cases" />;
  const { status = "active" } = await searchParams;
  const rows = await listRecallCases(ctx, { status });
  return (
    <>
      <PageHeader
        title="Recall cases"
        subtitle="Opened from the recall explorer; two approvals, then lots are marked recalled, customers notified and returns reconciled"
        actions={ctx.can("quality.genealogy.view") ? <LinkButton href="/quality/recall">Recall explorer</LinkButton> : undefined}
      />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter recall cases">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/quality/recalls?status=${v}`} className={filterLinkCls(status === v)}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No recall cases here" action={ctx.can("quality.genealogy.view") ? <LinkButton href="/quality/recall" variant="secondary">Recall explorer</LinkButton> : undefined}>
            Trace a lot, box, batch or complaint in the recall explorer and open a case from its scope. Run a mock recall to practise.
          </EmptyState>
        ) : (
          <Table head={["Case", "State", "Kind", "Title", "From", "Scope", "Opened"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/quality/recalls/${r.id}`}>
                    {r.number}
                  </Link>
                </Td>
                <Td>
                  <RecallStatusChip status={r.status} />
                </Td>
                <Td>{r.kindLabel}</Td>
                <Td className="max-w-[280px]">{r.title}</Td>
                <Td className="whitespace-nowrap">{r.subjectCode}</Td>
                <Td className="whitespace-nowrap">
                  {r.lots} lot(s)
                  <div className="text-[12px] text-muted">
                    {r.notified}/{r.customers} customer(s) notified
                  </div>
                </Td>
                <Td className="whitespace-nowrap">
                  {fmtDateTime(r.openedAt)}
                  <div className="text-[12px] text-muted">{r.openedByName}</div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
