import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { CUSTOMER_TRANSITIONS, CUSTOMER_STATUS_LABEL, customerSegmentLabels, customerSegmentOptions, formatAddress, getCustomer360, manilaToday, requirementFormOptions, type CustomerStatus } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { Money, SalesStatus } from "../../orders/sales-ui";
import {
  AddAddressForm,
  AddContactForm,
  AddressCommand,
  ArtworkForm,
  ContactCommand,
  CreditTermsForm,
  ItemCodeForm,
  ProfileForm,
  RequirementCommand,
  RequirementForm,
  StatusForm,
} from "./customer-forms";
import { registerAppHooks } from "@/modules/wiring";
import { PortalAccessPanel } from "./portal-access";
import { DeleteDraftCard } from "../../../delete-draft-button";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Customer" };

/** Customer 360 (US-4-01, US-4-02, US-4-06; docs/ux-system.md §9.8): every part shows only what the role may see. */
export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.view")) return <Forbidden what="customers" />;
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getCustomer360>>;
  try {
    d = await getCustomer360(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const c = d.customer;
  const [segLabels, segOptions] = await Promise.all([customerSegmentLabels(ctx), customerSegmentOptions(ctx, { keep: c.segment })]);
  const canEdit = ctx.can("masterdata.customer.edit");
  const canReq = ctx.can("masterdata.customer_requirement.create");
  const opts = ctx.can("masterdata.customer_requirement.view") && (canReq || canEdit) ? await requirementFormOptions(ctx, c.id) : null;
  const siteCode = (sid: string) => ctx.allowedSites.find((s) => s.id === sid)?.code ?? "";
  const statusOptions = (CUSTOMER_TRANSITIONS[c.status as CustomerStatus] ?? [])
    .filter((to) => (["on_hold"].includes(to) || c.status === "on_hold" ? ctx.can("finance.credit_terms.approve") : canEdit))
    .map((to) => ({ to, label: CUSTOMER_STATUS_LABEL[to] }));

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.code}</span>
            <SalesStatus status={c.status} />
            {c.segment && <Chip tone="neu">{segLabels.get(c.segment) ?? c.segment}</Chip>}
          </span>
        }
        actions={
          <>
            <LinkButton href="/sales/customers" variant="secondary">All customers</LinkButton>
            {ctx.can("sales.quote.create") && <LinkButton href={`/sales/quotations/new?customer=${c.id}`} variant="secondary">New quotation</LinkButton>}
            {ctx.can("sales.sales_order.create") && <LinkButton href={`/sales/new?customer=${c.id}`} variant="cta">New order</LinkButton>}
          </>
        }
      />
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Customer created. Finance sets the credit terms; add requirements and price lists below." />
        </div>
      )}
      {c.status === "on_hold" && (
        <div className="mb-4">
          <Banner tone="hold" title="Credit hold">New orders of this customer stop at credit approval until finance lifts the hold.</Banner>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Profile</CardTitle>
            <Dl
              items={[
                ["Ship to (default)", c.shipToAddress],
                ["Min shelf life at dispatch", `${c.minShelfLifeDays} days (default; product requirements below override it)`],
                ["Default lead time", c.defaultLeadTimeDays != null ? `${c.defaultLeadTimeDays} days` : "—"],
                ["Customer since", fmtDate(c.createdAt)],
                ...(c.notesInternal ? ([["Internal notes", c.notesInternal]] as [string, string][]) : []),
              ]}
            />
            {canEdit && <ProfileForm c={c} segments={segOptions} />}
            <StatusForm customerId={c.id} options={statusOptions} />
          </Card>

          <Card>
            <CardTitle>Credit and terms</CardTitle>
            {d.credit ? (
              <>
                <Dl
                  items={[
                    ["Credit limit", <Money key="l" value={d.credit.limit} />],
                    ["Payment terms", d.credit.paymentTermsDays != null ? `${d.credit.paymentTermsDays} days` : "—"],
                    ["Open order exposure", <Money key="e" value={d.credit.exposure} />],
                    ["Available", <Money key="a" value={d.credit.available} />],
                    ["Tax identifier", c.taxIdentifier ?? "—"],
                  ]}
                />
                <p className="mt-2 text-[12px] text-muted">Exposure counts confirmed to invoiced orders until receivables arrive with finance (Phase 6).</p>
                {ctx.can("finance.credit_terms.approve") && <CreditTermsForm c={c} />}
              </>
            ) : (
              <p className="text-[13px] text-muted">Credit limit, payment terms and tax identifier are visible to finance-authorised roles only.</p>
            )}
          </Card>

          <Card>
            <CardTitle>Contacts</CardTitle>
            {d.contacts.length === 0 ? (
              <p className="text-[13px] text-muted">No contacts yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.contacts.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div>
                      <p className="font-medium">
                        {k.name} {k.isPrimary && <Chip tone="info">Primary</Chip>}
                      </p>
                      <p className="text-[12px] text-muted">{[k.roleLabel, k.phone, k.email].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        {!k.isPrimary && <ContactCommand contactId={k.id} command="primary" label="Make primary" />}
                        <ContactCommand contactId={k.id} command="remove" label="Remove" confirm={`Remove ${k.name}?`} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <AddContactForm customerId={c.id} />}
          </Card>

          <Card>
            <CardTitle>Addresses</CardTitle>
            <ul className="flex flex-col divide-y divide-line">
              {d.addresses.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 py-2">
                  <p className="font-medium">
                    {a.label} {a.isDefaultShipTo && <Chip tone="ok">Default ship-to</Chip>} {a.isDefaultBillTo && <Chip tone="info">Default bill-to</Chip>}
                  </p>
                  <p className="text-[13px] text-fg-2">{formatAddress(a) || "—"}</p>
                  {(a.contactName || a.phone) && <p className="text-[12px] text-muted">{[a.contactName, a.phone].filter(Boolean).join(" · ")}</p>}
                  {canEdit && (
                    <div className="flex flex-wrap gap-1">
                      {!a.isDefaultShipTo && <AddressCommand addressId={a.id} command="default_ship_to" label="Default ship-to" />}
                      {!a.isDefaultBillTo && <AddressCommand addressId={a.id} command="default_bill_to" label="Default bill-to" />}
                      {!a.isDefaultShipTo && !a.isDefaultBillTo && <AddressCommand addressId={a.id} command="remove" label="Remove" confirm={`Remove ${a.label}?`} />}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && <AddAddressForm customerId={c.id} />}
          </Card>

          {ctx.can("masterdata.customer_requirement.view") && (
            <Card>
              <CardTitle>Requirements</CardTitle>
              {d.requirements.length === 0 ? (
                <EmptyState title="No requirements yet">Agreed specifications (shelf life, MOQ, carton count, artwork, documents) apply to orders and packing once approved.</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.requirements.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {r.kindLabel} <span className="text-muted">· {r.sku ?? "all products"}</span>
                        </p>
                        <SalesStatus status={r.effective ? "effective" : r.scheduled ? "scheduled" : r.status} />
                      </div>
                      <p className="text-[13px]">
                        <span className="font-semibold">{r.valueLabel}</span>{" "}
                        <span className="text-muted">
                          · v{r.versionNo} · from {fmtDate(r.effectiveFrom)}
                          {r.effectiveTo ? ` to ${fmtDate(r.effectiveTo)}` : ""}
                        </span>
                      </p>
                      {r.status === "pending_approval" && <p className="text-[12px] text-muted">Submitted by {r.submittedByName ?? "—"}; another person approves.</p>}
                      <div className="flex flex-wrap gap-1">
                        {r.status === "draft" && ctx.can("masterdata.customer_requirement.edit") && <RequirementCommand requirementId={r.id} command="submit" label="Send for approval" />}
                        {r.status === "pending_approval" && ctx.can("masterdata.customer_requirement.approve") && r.submittedBy !== ctx.userId && r.createdBy !== ctx.userId && (
                          <>
                            <RequirementCommand requirementId={r.id} command="approve" label="Approve" variant="cta" />
                            <RequirementCommand requirementId={r.id} command="return" label="Return" needsReason />
                            <RequirementCommand requirementId={r.id} command="reject" label="Reject" needsReason />
                          </>
                        )}
                        {r.status === "approved" && ctx.can("masterdata.customer_requirement.approve") && <RequirementCommand requirementId={r.id} command="retire" label="Retire" needsReason />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {canReq && opts && <RequirementForm customerId={c.id} products={opts.products} artwork={opts.artwork} today={manilaToday()} />}
              {canReq && opts && <ArtworkForm customerId={c.id} products={opts.products} />}
            </Card>
          )}

          <Card>
            <CardTitle>Customer item codes</CardTitle>
            {d.itemCodes.length === 0 ? (
              <p className="text-[13px] text-muted">No mapping: documents show our SKU codes only.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.itemCodes.map((i) => (
                  <li key={i.id}>
                    <span className="font-mono">{i.sku}</span> → <span className="font-mono font-semibold">{i.customerItemCode}</span>
                    {i.customerDescription ? <span className="text-muted"> · {i.customerDescription}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && opts && <ItemCodeForm customerId={c.id} products={opts.products} />}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {ctx.can("sales.sales_order.view") && (
            <Card>
              <CardTitle>Orders</CardTitle>
              {d.orders.length === 0 ? (
                <EmptyState title="No orders yet">Orders for this customer in your sites appear here.</EmptyState>
              ) : (
                <Table head={["Order", "Site", "Requested", "Value", "Status"]}>
                  {d.orders.slice(0, 15).map((o) => (
                    <tr key={o.id} className="hover:bg-surface-2">
                      <Td>
                        <Link className="font-medium text-primary-text hover:underline" href={`/sales/${o.id}`}>
                          {o.orderNumber}
                        </Link>
                        {o.customerPoNumber && <span className="block text-[11px] text-muted">PO {o.customerPoNumber}</span>}
                      </Td>
                      <Td>{siteCode(o.siteId)}</Td>
                      <Td>{fmtDate(o.requestedDeliveryOn)}</Td>
                      <Td>
                        <Money value={o.value} />
                      </Td>
                      <Td>
                        <SalesStatus status={o.status} />
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
              <p className="mt-2 text-[12px] text-muted">{d.openOrders.length} open order{d.openOrders.length === 1 ? "" : "s"}.</p>
            </Card>
          )}

          {ctx.can("sales.quote.view") && (
            <Card>
              <CardTitle>Quotations</CardTitle>
              {d.quotes.length === 0 ? (
                <p className="text-[13px] text-muted">No quotations yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.quotes.slice(0, 10).map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                      <Link className="font-medium text-primary-text hover:underline" href={`/sales/quotations/${q.id}`}>
                        {q.quoteNumber}
                      </Link>
                      <span className="text-muted">valid until {fmtDate(q.validUntil)}</span>
                      <Money value={q.totalAmount} />
                      <SalesStatus status={q.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {ctx.can("sales.price_list.view") && (
            <Card>
              <CardTitle>Price lists</CardTitle>
              {d.priceLists.length === 0 ? (
                <p className="text-[13px] text-muted">No customer price list: the general list applies.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {d.priceLists.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <Link className="text-primary-text hover:underline" href={`/sales/price-lists/${p.id}`}>
                        {p.code} v{p.versionNo}
                      </Link>
                      <span className="text-muted">from {fmtDate(p.effectiveFrom)}</span>
                      <SalesStatus status={p.effective ? "effective" : p.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {ctx.can("sales.shipment.view") && (
            <Card>
              <CardTitle>Shipments</CardTitle>
              {d.shipments.length === 0 ? (
                <p className="text-[13px] text-muted">No shipments yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.shipments.slice(0, 10).map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                      <span className="font-medium">{s.deliveryReceiptNumber}</span>
                      <Link className="text-primary-text hover:underline" href={`/sales/${s.orderId}`}>
                        {s.orderNumber}
                      </Link>
                      <span className="text-muted">{s.deliveredAt ? `delivered ${fmtDateTime(s.deliveredAt)}` : `dispatched ${fmtDateTime(s.dispatchedAt)}`}</span>
                      <Link className="text-primary-text hover:underline" href={`/print/delivery-receipt/${s.id}`} target="_blank">
                        Print DR
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <PortalAccessPanel ctx={ctx} customerId={c.id} />

          {d.sections.map((s) => (
            <Card key={s.key}>
              <CardTitle>{s.title}</CardTitle>
              {s.rows.length === 0 ? (
                <p className="text-[13px] text-muted">None.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {s.rows.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      {r.href ? (
                        <Link className="text-primary-text hover:underline" href={r.href}>
                          {r.label}
                        </Link>
                      ) : (
                        <span>{r.label}</span>
                      )}
                      {r.status && <SalesStatus status={r.status} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}

          <Card>
            <CardTitle>History</CardTitle>
            {d.history.length === 0 ? (
              <p className="text-[13px] text-muted">No changes recorded.</p>
            ) : (
              <ol className="flex flex-col gap-1.5 text-[13px]">
                {d.history.map((h) => (
                  <li key={h.id} className="border-l-2 border-line pl-3">
                    <span className="font-medium">{h.action.split(".").slice(1).join(" ").replace(/_/g, " ")}</span>
                    <span className="block text-[12px] text-muted">
                      {fmtDateTime(h.occurredAt)} · {h.actor}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        {(c.status === "prospect" || c.status === "active") && (ctx.can("masterdata.customer.edit") || ctx.can("masterdata.customer.create")) && <DeleteDraftCard kind="customer" id={c.id} what="customer" note="If nothing uses this customer yet (no quotation, order, invoice, price list or return), you can delete it with its addresses and contacts." />}
      </div>
    </>
  );
}
