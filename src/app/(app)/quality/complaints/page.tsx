import Link from "next/link";
import { Search } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listComplaints } from "@/modules/quality";
import { Card, EmptyState, Input, LinkButton, PageHeader, Table, Td, buttonClass, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ComplaintStatusChip, TraceMatchChip } from "./_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Open, investigating, resolved"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.complaint.view")) return <Forbidden what="complaints" />;
  const { status = "active", q = "" } = await searchParams;
  const rows = await listComplaints(ctx, { status, q });
  return (
    <>
      <PageHeader
        title="Complaints"
        subtitle={`Customer complaints at your sites (${ctx.allowedSites.map((s) => s.code).join(", ")}), traced from the label's lot or box`}
        actions={ctx.can("quality.complaint.create") ? <LinkButton href="/quality/complaints/new" variant="cta">Log complaint</LinkButton> : undefined}
      />
      <Card>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap gap-2" aria-label="Filter complaints">
            {FILTERS.map(([v, label]) => (
              <Link key={v} href={`/quality/complaints?status=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cx("rounded-full border px-3 py-1 text-[13px]", status === v ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
                {label}
              </Link>
            ))}
          </nav>
          <form method="get" action="/quality/complaints" className="flex min-w-0 gap-2">
            <input type="hidden" name="status" value={status} />
            <Input name="q" defaultValue={q} placeholder="Number, customer or lot" aria-label="Search complaints" className="min-w-0" />
            <button type="submit" className={buttonClass("secondary")} aria-label="Search">
              <Search size={16} />
            </button>
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={q ? "No complaint matches" : "No complaints here"} action={ctx.can("quality.complaint.create") ? <LinkButton href="/quality/complaints/new" variant="secondary">Log complaint</LinkButton> : undefined}>
            {q ? "Try another number, customer name or lot." : "Complaints logged by sales or QA appear here with their trace status."}
          </EmptyState>
        ) : (
          <Table head={["Complaint", "Status", "Customer", "Product / lot", "Category", "Severity", "Received"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/quality/complaints/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode}</div>
                </Td>
                <Td>
                  <ComplaintStatusChip status={r.status} />
                  {r.recallReviewFlagged && (
                    <div className="mt-0.5">
                      <Chip tone="bad">Recall assessment</Chip>
                    </div>
                  )}
                </Td>
                <Td>{r.customerName}</Td>
                <Td>
                  {r.productName ?? "—"}
                  <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
                    {r.lotNumber ?? ""} <TraceMatchChip match={r.traceMatch} />
                  </div>
                </Td>
                <Td className="text-[13px]">{r.categoryLabel}</Td>
                <Td>{r.severity ?? <span className="text-muted">Awaiting QA</span>}</Td>
                <Td className="whitespace-nowrap">{fmtDateTime(r.receivedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
