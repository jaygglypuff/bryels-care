import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSuppliers } from "@/modules/masterdata";
import { listAslQueue } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approved suppliers" };

/** Approved-supplier list (US-6-01, W04-11): proposals waiting for QA, then every supplier. */
export default async function SuppliersPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" />;
  const [queue, sups] = await Promise.all([listAslQueue(ctx), listSuppliers(ctx)]);
  return (
    <>
      <PageHeader title="Approved suppliers" subtitle="Procurement proposes supplier × material pairs; QA approves or suspends them. Only approved pairs can be ordered." />
      <SubNav />
      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle>Waiting for QA</CardTitle>
          {queue.length === 0 ? (
            <p className="text-[13px] text-muted">No proposals waiting.</p>
          ) : (
            <Table head={["Supplier", "Material", "Proposal", "Proposed by", "Evidence / note"]}>
              {queue.map((q) => (
                <tr key={q.id}>
                  <Td>
                    <Link className="text-primary-text hover:underline" href={`/procurement/suppliers/${q.supplierId}`}>
                      {q.supplierName}
                    </Link>
                  </Td>
                  <Td>
                    {q.materialCode}
                    <div className="text-[12px] text-muted">{q.materialName}</div>
                  </Td>
                  <Td>
                    <Chip tone={q.action === "suspend" ? "warn" : "appr"}>{q.actionLabel}</Chip>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {q.proposedByName}
                    <div className="text-[12px] text-muted">{fmtDateTime(q.proposedAt)}</div>
                  </Td>
                  <Td className="text-[13px]">{q.note}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardTitle>Suppliers</CardTitle>
          {sups.length === 0 ? (
            <EmptyState title="No suppliers yet">Suppliers are created under Master data → Suppliers.</EmptyState>
          ) : (
            <Table head={["Supplier", "Quality status", "Lead time", "Receipts"]}>
              {sups.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link className="text-primary-text hover:underline" href={`/procurement/suppliers/${s.id}`}>
                      {s.name}
                    </Link>
                    <div className="text-[12px] text-muted">{s.code}</div>
                  </Td>
                  <Td>
                    <Chip tone={s.qualityStatus === "approved" ? "ok" : s.qualityStatus === "suspended" ? "bad" : "warn"}>{s.qualityStatus}</Chip>
                  </Td>
                  <Td>{s.defaultLeadTimeDays !== null ? `${s.defaultLeadTimeDays} d` : "—"}</Td>
                  <Td>{s.receipts}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
