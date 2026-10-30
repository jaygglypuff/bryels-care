import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getSupplier } from "@/modules/masterdata";
import { Card, CardTitle, Dl, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { ReceiptStatusChip, SupplierStatusChip } from "@/ui/receiving";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { SupplierForm } from "../supplier-form";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" />;
  const { id } = await params;
  const { saved } = await searchParams;
  let s: Awaited<ReturnType<typeof getSupplier>>;
  try {
    s = await getSupplier(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={s.name}
        subtitle={
          <>
            <Link href="/masterdata/suppliers" className="text-primary-text hover:underline">Suppliers</Link> · {s.code} · <SupplierStatusChip status={s.qualityStatus} />
          </>
        }
        actions={
          // Wave 4 W4A: approved-material list, prices, MOQ and lead times live on the procurement screen.
          <Link href={`/procurement/suppliers/${s.id}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
            Approved list and prices
          </Link>
        }
      />
      {saved && <Banner tone="ok" title="Supplier saved" />}
      {s.qualityStatus === "suspended" && <Banner tone="bad" title="Suspended: receipt lines from this supplier cannot be posted">{s.qualityStatusReason}</Banner>}
      <Card>
        <CardTitle>Details</CardTitle>
        <Dl
          items={[
            ["Contact", [s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"],
            ["Address", [s.addressLine1, s.city, s.country].filter(Boolean).join(", ") || "—"],
            ["Payment terms", s.paymentTermsDays != null ? `${s.paymentTermsDays} days` : "—"],
            ["Lead time", s.defaultLeadTimeDays != null ? `${s.defaultLeadTimeDays} days` : "—"],
            ["Active", s.isActive ? "Yes" : "No"],
            ["Updated", fmtDateTime(s.updatedAt)],
          ]}
        />
      </Card>
      <Card>
        <CardTitle>Materials supplied</CardTitle>
        {s.materials.length === 0 ? (
          <p className="text-[13px] text-muted">No materials listed. The approved-supplier list and its approvals arrive with purchasing (Phase 6).</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {s.materials.map((m) => (
              <li key={m.id}>
                <Chip tone={m.isApproved ? "ok" : "neu"}>
                  {m.materialCode} · {m.materialName}
                  {m.isApproved ? "" : " (not yet approved)"}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {ctx.can("procurement.goods_receipt.view") && (
        <Card>
          <CardTitle>Recent receipts at your sites</CardTitle>
          {s.receipts.length === 0 ? (
            <EmptyState title="No receipts yet" />
          ) : (
            <Table head={["Receipt", "Status", "Supplier doc", "Received"]}>
              {s.receipts.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/inventory/receive/${r.id}`} className="font-mono text-primary-text hover:underline">{r.receiptNumber ?? "Draft"}</Link></Td>
                  <Td><ReceiptStatusChip status={r.status} /></Td>
                  <Td>{r.supplierDocumentNumber ?? "—"}</Td>
                  <Td>{fmtDate(r.receivedAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {ctx.can("masterdata.supplier.edit") && (
        <div>
          <h2 className="mb-3 font-display text-[17px] font-semibold">Edit supplier</h2>
          <SupplierForm initial={s} />
        </div>
      )}
      {s.qualityStatus === "new" && (ctx.can("masterdata.supplier.edit") || ctx.can("masterdata.supplier.create")) && <DeleteDraftCard kind="supplier" id={s.id} what="supplier" note="This supplier is still new (not yet evaluated). If nothing uses it yet (no approved material, order, receipt or bill), you can delete it." />}
    </div>
  );
}
