import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listHolds } from "@/modules/inventory/holds";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { HoldStatusChip } from "@/ui/receiving";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "QA holds" };

const TABS = [
  ["active", "Active"],
  ["closed", "Closed"],
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
        title="QA holds"
        subtitle={`${ctx.currentSite.code} · lots and locations blocked for allocation, issue and shipment until QA lifts the hold`}
        actions={
          <>
            {ctx.can("inventory.held_stock_issue.approve") && <LinkButton href="/quality/holds/issue" variant="secondary">Held-stock issue</LinkButton>}
            {ctx.can("quality.hold.create") && <LinkButton href="/quality/holds/new" variant="danger">Place hold</LinkButton>}
          </>
        }
      />
      <nav className="mb-4 flex gap-2" aria-label="Hold status">
        {TABS.map(([v, t]) => (
          <LinkButton key={v} href={`/quality/holds?status=${v}`} variant={status === v ? "primary" : "secondary"} size="sm">
            {t}
          </LinkButton>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={status === "active" ? "No active holds" : "No holds"} action={ctx.can("quality.hold.create") ? <LinkButton href="/quality/holds/new">Place a hold</LinkButton> : undefined}>
          Holds placed on lots or locations at this site appear here.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((h) => (
              <li key={h.id}>
                <Link href={`/quality/holds/${h.id}`}>
                  <Card className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-primary-text">{h.holdNumber}</span>
                      <HoldStatusChip status={h.status} />
                    </div>
                    <p className="text-[13px]">{h.lotNumber ? `Lot ${h.lotNumber}` : `Location ${h.locationCode}`} · {h.lotCount} lot(s)</p>
                    <p className="text-[12px] text-muted">{h.reason}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["Hold", "Status", "Scope", "Reason", "Opened", "Resolution"]}>
            {rows.map((h) => (
              <tr key={h.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/quality/holds/${h.id}`} className="font-mono font-medium text-primary-text hover:underline">{h.holdNumber}</Link>
                </Td>
                <Td><HoldStatusChip status={h.status} /></Td>
                <Td>
                  {h.lotNumber ? `Lot ${h.lotNumber}` : `Location ${h.locationCode}`}
                  <span className="block text-[12px] text-muted">{h.lotCount} lot(s)</span>
                </Td>
                <Td className="max-w-[280px]">{h.reason}</Td>
                <Td>
                  {fmtDateTime(h.openedAt)}
                  <span className="block text-[12px] text-muted">{h.openedByName}</span>
                </Td>
                <Td>{h.resolution ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
