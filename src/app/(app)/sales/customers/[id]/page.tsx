import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { CUSTOMER_TRANSITIONS, customerSegmentLabels, customerSegmentOptions, formatAddress, getCustomer360, manilaToday, requirementFormOptions, type CustomerStatus } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { Money, SalesStatus, ShipChip, salesWord } from "../../orders/sales-ui";
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
import { DeleteDraftButton } from "../../../delete-draft-button";
import { DoNext, whoDoes } from "../../next-step";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Customer" };

/** Customer page (US-4-01, US-4-02, US-4-06; docs/ux-system.md §9.8): every part shows only what the role may see. */
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
    .map((to) => ({ to, label: salesWord(to) }));
  const canOrder = ctx.can("sales.sales_order.create");
  const canQuote = ctx.can("sales.quote.create");
  const canDelete = (c.status === "prospect" || c.status === "active") && (ctx.can("masterdata.customer.edit") || ctx.can("masterdata.customer.create"));
  // ADR-091: the owner may approve a customer rule they drafted themselves (recorded as "own request").
  const mayDecideRule = (r: { submittedBy: string | null; createdBy: string | null }) => !ctx.sodConflictAt(r.submittedBy, null) && !ctx.sodConflictAt(r.createdBy, null);

  const next =
    c.status === "on_hold" ? (
      <DoNext
        text="Stopped: unpaid bills. New orders for this customer wait for approval."
        waitingFor={`Waiting for ${await whoDoes(ctx, "finance.credit_terms.approve", null, "finance")} to start them again when the bills are paid.`}
      />
    ) : c.status === "inactive" ? (
      <DoNext text="This customer is not buying any more. Change it under ⋯ More if they come back." />
    ) : c.status === "prospect" ? (
      canQuote ? (
        <DoNext text="Next: send them a price offer." action={{ label: "Make a price offer", href: `/sales/quotations/new?customer=${c.id}` }} />
      ) : (
        <DoNext text="New customer, not buying yet." />
      )
    ) : canOrder ? (
      <DoNext text="Next: when they order, enter it here." action={{ label: "New order for this customer", href: `/sales/new?customer=${c.id}` }} />
    ) : null;

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/sales/customers" className="text-primary-text hover:underline">Customers</Link>
            <RecordNo>{c.code}</RecordNo>
            <SalesStatus status={c.status} />
            {c.segment && <Chip tone="neu">{segLabels.get(c.segment) ?? c.segment}</Chip>}
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              {canQuote && c.status !== "prospect" && <LinkButton href={`/sales/quotations/new?customer=${c.id}`} variant="secondary">Make a price offer</LinkButton>}
              {canOrder && c.status === "prospect" && <LinkButton href={`/sales/new?customer=${c.id}`} variant="secondary">New order</LinkButton>}
              {ctx.can("sales.price_list.edit") && <LinkButton href={`/sales/price-lists/new?customer=${c.id}`} variant="secondary">Set prices for this customer</LinkButton>}
              {statusOptions.length > 0 && <StatusForm customerId={c.id} options={statusOptions} />}
              {canDelete && (
                <div>
                  <p className="mb-2 text-[13px] text-fg-2">If nothing uses this customer yet (no price offer, order, invoice, prices or return), you can delete it with its addresses and contacts.</p>
                  <DeleteDraftButton kind="customer" id={c.id} what="this customer" label="Delete customer" />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one customer: how to reach them, what they ordered, what they owe and their special rules.</PageIntro>
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={`Customer saved as ${c.code}.`}>Finance sets how much they may owe. Add special rules and prices below when you need them.</Banner>
        </div>
      )}
      {next}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>How to reach them</CardTitle>
            <Dl
              items={[
                ["Phone", c.phone ?? "—"],
                ["Deliver to", c.shipToAddress],
                ["Contact person", c.contactName ?? "—"],
                ["E-mail", c.email ?? "—"],
              ]}
            />
            <div className="mt-3">
              <MoreDetails>
                <Dl
                  items={[
                    ["Shortest shelf life allowed", `${c.minShelfLifeDays} days left when sent out (a special rule per product can change it)`],
                    ["Usual days from order to delivery", c.defaultLeadTimeDays != null ? `${c.defaultLeadTimeDays} days` : "—"],
                    ["Customer since", fmtDate(c.createdAt)],
                    ...(c.notesInternal ? ([["Note for our team", c.notesInternal]] as [string, string][]) : []),
                  ]}
                />
                {canEdit && <ProfileForm c={c} segments={segOptions} />}
              </MoreDetails>
            </div>
          </Card>

          <Card>
            <CardTitle>Money</CardTitle>
            {d.credit ? (
              <>
                <Dl
                  items={[
                    ["Most they may owe", <Money key="l" value={d.credit.limit} />],
                    ["Days to pay", d.credit.paymentTermsDays != null ? `${d.credit.paymentTermsDays} days` : "—"],
                    ["Open orders worth", <Money key="e" value={d.credit.exposure} />],
                    ["Still allowed", <Money key="a" value={d.credit.available} />],
                    ["Tax number", c.taxIdentifier ?? "—"],
                  ]}
                />
                <p className="mt-2 text-[12px] text-muted">Open orders count from confirmed up to billed. Unpaid invoices are not counted yet.</p>
                {ctx.can("finance.credit_terms.approve") && <CreditTermsForm c={c} />}
              </>
            ) : (
              <p className="text-[13px] text-muted">How much they may owe and the days to pay are shown to finance only.</p>
            )}
          </Card>

          <Card>
            <CardTitle>People to talk to</CardTitle>
            {d.contacts.length === 0 ? (
              <p className="text-[13px] text-muted">Nobody added yet{canEdit ? ": tap Add contact." : "."}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.contacts.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div>
                      <p className="font-medium">
                        {k.name} {k.isPrimary && <Chip tone="info">Main contact</Chip>}
                      </p>
                      <p className="text-[12px] text-muted">{[k.roleLabel, k.phone, k.email].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        {!k.isPrimary && <ContactCommand contactId={k.id} command="primary" label="Make main contact" />}
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
                    {a.label} {a.isDefaultShipTo && <Chip tone="ok">Usual deliver-to</Chip>} {a.isDefaultBillTo && <Chip tone="info">Usual bill-to</Chip>}
                  </p>
                  <p className="text-[13px] text-fg-2">{formatAddress(a) || "—"}</p>
                  {(a.contactName || a.phone) && <p className="text-[12px] text-muted">{[a.contactName, a.phone].filter(Boolean).join(" · ")}</p>}
                  {canEdit && (
                    <div className="flex flex-wrap gap-1">
                      {!a.isDefaultShipTo && <AddressCommand addressId={a.id} command="default_ship_to" label="Make usual deliver-to" />}
                      {!a.isDefaultBillTo && <AddressCommand addressId={a.id} command="default_bill_to" label="Make usual bill-to" />}
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
              <CardTitle>Special rules for this customer</CardTitle>
              {d.requirements.length === 0 ? (
                <EmptyState title="No special rules yet">
                  For example: at least 12 months before expiry, a minimum order, how many per carton, their label design or papers they need. A rule applies to orders and packing once it is approved.
                </EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.requirements.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {r.kindLabel} <span className="text-muted">· {r.productName ?? r.sku ?? "all products"}</span>
                        </p>
                        <SalesStatus status={r.effective ? "effective" : r.scheduled ? "scheduled" : r.status} />
                      </div>
                      <p className="text-[13px]">
                        <span className="font-semibold">{r.valueLabel}</span>{" "}
                        <span className="text-muted">
                          · from {fmtDate(r.effectiveFrom)}
                          {r.effectiveTo ? ` to ${fmtDate(r.effectiveTo)}` : ""} · version {r.versionNo}
                        </span>
                      </p>
                      {r.status === "pending_approval" && <p className="text-[12px] text-muted">Sent by {r.submittedByName ?? "—"}; another person approves (the owner may approve their own).</p>}
                      <div className="flex flex-wrap gap-1">
                        {r.status === "draft" && ctx.can("masterdata.customer_requirement.edit") && <RequirementCommand requirementId={r.id} command="submit" label="Send for approval" />}
                        {r.status === "pending_approval" && ctx.can("masterdata.customer_requirement.approve") && mayDecideRule(r) && (
                          <>
                            <RequirementCommand requirementId={r.id} command="approve" label="Approve" variant="cta" />
                            <RequirementCommand requirementId={r.id} command="return" label="Send back" needsReason />
                            <RequirementCommand requirementId={r.id} command="reject" label="Say no" needsReason />
                          </>
                        )}
                        {r.status === "approved" && ctx.can("masterdata.customer_requirement.approve") && <RequirementCommand requirementId={r.id} command="retire" label="Stop using" needsReason />}
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
            <CardTitle>Their own product codes</CardTitle>
            {d.itemCodes.length === 0 ? (
              <p className="text-[13px] text-muted">None: our papers show our product codes only.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.itemCodes.map((i) => (
                  <li key={i.id}>
                    {i.productName ?? i.sku} → <span className="font-mono font-semibold">{i.customerItemCode}</span>
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
            <section aria-label="Orders" className="flex flex-col gap-2">
              <h2 className="text-[16px] font-semibold">Orders</h2>
              {d.orders.length === 0 ? (
                <EmptyState title="No orders yet" action={canOrder && c.status !== "prospect" ? <LinkButton href={`/sales/new?customer=${c.id}`}>New order</LinkButton> : undefined}>
                  Orders for this customer at your sites show here.
                </EmptyState>
              ) : (
                <PlainList label="Orders">
                  {d.orders.slice(0, 15).map((o) => (
                    <PlainRow
                      key={o.id}
                      href={`/sales/${o.id}`}
                      title={`Deliver by ${fmtDate(o.requestedDeliveryOn)}`}
                      code={o.orderNumber}
                      status={<SalesStatus status={o.status} />}
                      facts={[siteCode(o.siteId), o.customerPoNumber ? `their no. ${o.customerPoNumber}` : null].filter(Boolean).join(" · ")}
                      aside={<Money className="text-[15px] font-semibold tabular text-fg" value={o.value} />}
                    />
                  ))}
                </PlainList>
              )}
              <p className="text-[12px] text-muted">{d.openOrders.length} open order{d.openOrders.length === 1 ? "" : "s"}.</p>
            </section>
          )}

          {ctx.can("sales.quote.view") && (
            <Card>
              <CardTitle>Price offers</CardTitle>
              {d.quotes.length === 0 ? (
                <p className="text-[13px] text-muted">No price offers yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.quotes.slice(0, 10).map((q) => (
                    <li key={q.id}>
                      <Link href={`/sales/quotations/${q.id}`} className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 py-2 text-[13px] hover:bg-surface-2">
                        <span className="min-w-0">
                          Good until {fmtDate(q.validUntil)} <span className="font-mono text-[12px] text-muted">· {q.quoteNumber}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <SalesStatus status={q.status} />
                          <Money className="font-semibold tabular" value={q.totalAmount} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {ctx.can("sales.price_list.view") && (
            <Card>
              <CardTitle>Prices</CardTitle>
              {d.priceLists.length === 0 ? (
                <p className="text-[13px] text-muted">No prices just for them: the general prices apply.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.priceLists.map((p) => (
                    <li key={p.id}>
                      <Link href={`/sales/price-lists/${p.id}`} className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 py-2 text-[13px] hover:bg-surface-2">
                        <span>
                          From {fmtDate(p.effectiveFrom)} <span className="font-mono text-[12px] text-muted">· {p.code} v{p.versionNo}</span>
                        </span>
                        <SalesStatus status={p.effective ? "effective" : p.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {ctx.can("sales.shipment.view") && (
            <Card>
              <CardTitle>Sent out</CardTitle>
              {d.shipments.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing sent out yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.shipments.slice(0, 10).map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                      <span className="min-w-0">
                        {s.deliveredAt ? `Delivered ${fmtDateTime(s.deliveredAt)}` : `Sent ${fmtDateTime(s.dispatchedAt)}`}{" "}
                        <span className="font-mono text-[12px] text-muted">
                          · <Link className="hover:underline" href={`/sales/${s.orderId}`}>{s.orderNumber}</Link> · {s.deliveryReceiptNumber}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <ShipChip status={s.deliveredAt ? "delivered" : "dispatched"} />
                        <Link className="inline-flex min-h-[44px] items-center text-primary-text hover:underline" href={`/print/delivery-receipt/${s.id}`} target="_blank">
                          Print delivery receipt
                        </Link>
                      </span>
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
            <CardTitle>What happened</CardTitle>
            {d.history.length === 0 ? (
              <p className="text-[13px] text-muted">No changes yet.</p>
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
      </div>
    </>
  );
}
