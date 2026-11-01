import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getSupplier, lookupOptions } from "@/modules/masterdata";
import { Card, CardTitle, Dl, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { ReceiptStatusChip, SupplierStatusChip } from "@/ui/receiving";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { waitingFor } from "../../../waiting-for";
import { SupplierForm } from "../supplier-form";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" permission="masterdata.supplier.view" />;
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
            <Link href="/procurement/suppliers" className="text-primary-text hover:underline">Suppliers</Link> · <span className="font-mono text-[12px] text-muted">{s.code}</span> · <SupplierStatusChip status={s.qualityStatus} />
          </>
        }
      />
      <PageIntro>A company you buy from: who to call, and which materials QA has approved from them.</PageIntro>
      {s.qualityStatus === "new" ? (
        <NextStep text="This supplier is new: QA checks it before we buy." waitingFor={await waitingFor(ctx, "masterdata.supplier.approve", null, "to check the supplier", "QA")} />
      ) : s.qualityStatus === "suspended" ? (
        <NextStep text="Stopped: do not buy from this supplier." waitingFor={await waitingFor(ctx, "masterdata.supplier.approve", null, "to decide if we may buy from them again", "QA")} />
      ) : (
        <NextStep text="To buy, see what we may order from this supplier and the prices." action={{ label: "What we buy here and prices", href: `/procurement/suppliers/${s.id}` }} />
      )}
      {saved && <Banner tone="ok" title="Supplier saved" />}
      {s.qualityStatus === "suspended" && <Banner tone="bad" title="Suspended: deliveries from this supplier cannot be received">{s.qualityStatusReason}</Banner>}
      <Card>
        <CardTitle>Details</CardTitle>
        <Dl
          items={[
            ["Contact", [s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"],
            ["Address", [s.addressLine1, s.city, s.country].filter(Boolean).join(", ") || "—"],
            ["Pay within", s.paymentTermsDays != null ? `${s.paymentTermsDays} days` : "—"],
            ["Order to delivery", s.defaultLeadTimeDays != null ? `${s.defaultLeadTimeDays} days` : "—"],
            ["In use", s.isActive ? "Yes" : "No"],
            ["Updated", fmtDateTime(s.updatedAt)],
          ]}
        />
      </Card>
      <Card>
        <CardTitle>Materials we buy here</CardTitle>
        {s.materials.length === 0 ? (
          <p className="text-[13px] text-muted">None yet. Add one from a material&apos;s page (Usual supplier) or under &quot;What we buy here and prices&quot;.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {s.materials.map((m) => (
              <li key={m.id}>
                <Chip tone={m.isApproved ? "ok" : "neu"}>
                  {m.materialName}
                  {m.brand ? ` · ${m.brand}` : ""}
                  {m.packQty ? ` · ${Number(m.packQty).toLocaleString("en-PH", { maximumFractionDigits: 6 })} ${m.packUom}` : ""}
                  {m.isApproved ? "" : " (waiting for QA)"}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {ctx.can("procurement.goods_receipt.view") && (
        <Card>
          <CardTitle>Recent deliveries at your sites</CardTitle>
          {s.receipts.length === 0 ? (
            <EmptyState title="No deliveries yet">Deliveries from this supplier show here once received.</EmptyState>
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
          <h2 className="mb-3 font-display text-[17px] font-semibold">Change details</h2>
          <SupplierForm initial={s} categories={await lookupOptions(db, ctx.organizationId, "supplier_category", { keep: s.category })} />
        </div>
      )}
      {s.qualityStatus === "new" && (ctx.can("masterdata.supplier.edit") || ctx.can("masterdata.supplier.create")) && <DeleteDraftCard kind="supplier" id={s.id} what="supplier" note="This supplier is still new (not yet evaluated). If nothing uses it yet (no approved material, order, receipt or bill), you can delete it." />}
    </div>
  );
}
