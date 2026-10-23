import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listRoutings } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";

export const metadata: Metadata = { title: "Routings" };

export default async function RoutingsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="routings" />;
  const rows = await listRoutings(ctx);
  return (
    <div>
      <PageHeader
        title="Routings"
        subtitle="Versioned process steps per product: line clearances, weighing, process steps with parameters, checklists and work instructions."
        actions={
          <>
            {ctx.can("masterdata.work_instruction.view") && <LinkButton href="/masterdata/work-instructions" variant="secondary">Work instructions</LinkButton>}
            {ctx.can("masterdata.routing.create") && <LinkButton href="/masterdata/routings/new" variant="cta">New routing</LinkButton>}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No routings yet">A product needs an approved routing before a batch can be planned.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => (
              <Link key={r.id} href={`/masterdata/routings/${r.id}`}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-semibold">{r.code}</p>
                      <p className="font-medium">{r.productName}</p>
                    </div>
                    {r.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={r.open?.status ?? "draft"} />}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{r.effective ? `Rev ${r.effective.revisionNo} · ${r.effective.stepCount} steps` : "No effective revision"}</p>
                </Card>
              </Link>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Routing", "Product", "Effective revision", "Effective from", "Steps", "Open revision"]}>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/masterdata/routings/${r.id}`} className="font-mono font-semibold text-primary-text hover:underline">
                      {r.code}
                    </Link>
                    <span className="block text-[12px] text-muted">{r.name}</span>
                  </Td>
                  <Td>
                    {r.productName} <span className="text-muted">({r.productSku})</span>
                  </Td>
                  <Td>{r.effective ? `Rev ${r.effective.revisionNo}` : <span className="text-muted">None</span>}</Td>
                  <Td>{r.effective?.effectiveFrom ? fmtDate(r.effective.effectiveFrom) : "—"}</Td>
                  <Td>{r.effective?.stepCount ?? "—"}</Td>
                  <Td>
                    {r.open ? (
                      <Link href={`/masterdata/routings/${r.id}/revisions/${r.open.id}`} className="flex items-center gap-2 hover:underline">
                        Rev {r.open.revisionNo} <VersionChip status={r.open.status} />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
