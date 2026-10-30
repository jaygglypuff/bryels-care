import Link from "next/link";
import { Plus, Search, UserRound } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { customerOutstanding, customerSegmentLabels, getCustomer360, listCustomers, type Customer360 } from "@/modules/sales";
import { EmptyState, Input, LinkButton, PageHeader, Select, buttonClass, cx } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { Money } from "../orders/sales-ui";
import { CustomerPanel, PANEL_TABS, type PanelTab } from "./customer-panel";

export const metadata = { title: "Customers" };

type SP = { q?: string; status?: string; segment?: string; c?: string; tab?: string };

/**
 * Customers as a split view (mockup panel 6): a searchable list on the left (name first, e-mail or phone
 * small, what they owe for finance roles, open orders) and the selected customer (?c=<id>) on the right
 * with Orders / History / Details. From 1024 px both sides show; on phones and portrait tablets the list
 * and the customer are separate screens (the customer screen has "All customers" to go back).
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.view")) return <Forbidden what="customers" />;
  const f = await searchParams;
  const [rows, segLabels] = await Promise.all([listCustomers(ctx, { q: f.q, status: f.status, segment: f.segment, sort: "name" }), customerSegmentLabels(ctx)]);
  const selectedId = f.c && /^[0-9a-f-]{36}$/i.test(f.c) ? f.c : null;
  let selected: Customer360 | null = null;
  let notFound = false;
  if (selectedId) {
    try {
      selected = await getCustomer360(ctx, selectedId);
    } catch (e) {
      if (e instanceof DomainError && e.code === "not_found") notFound = true;
      else throw e;
    }
  }
  const owed = selected ? await customerOutstanding(ctx, [selected.customer.id]) : null;
  const tab: PanelTab = PANEL_TABS.some((t) => t.key === f.tab) ? (f.tab as PanelTab) : "orders";
  const canCreate = ctx.can("masterdata.customer.create");
  const filtered = !!(f.q || f.status || f.segment);
  const keep = (over: Partial<SP>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, status: f.status, segment: f.segment, c: f.c, tab: f.tab, ...over })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/sales/customers?${s}` : "/sales/customers";
  };
  const showDetail = !!selectedId;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Who you sell to, what they ordered and what they owe."
        actions={
          <>
            {ctx.can("masterdata.customer.export") && (
              <a className={buttonClass("secondary")} href={`/api/v1/sales/customers/export?format=csv${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`}>
                Export CSV
              </a>
            )}
            {canCreate ? <LinkButton href="/sales/customers/new" variant="secondary">New customer</LinkButton> : null}
            {ctx.can("sales.sales_order.create") ? (
              <LinkButton href={selected ? `/sales/new?customer=${selected.customer.id}` : "/sales/new"} variant="cta">
                <Plus size={16} aria-hidden /> New customer order
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start">
        {/* Left: the list (its own screen below 1024 px). */}
        <div className={cx("min-w-0", showDetail && "hidden lg:block")}>
          <form className="mb-3 flex flex-col gap-2" role="search" action="/sales/customers">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <Input name="q" defaultValue={f.q ?? ""} placeholder="Search customer: name, e-mail or phone" aria-label="Search customers" className="pl-10" type="search" />
            </div>
            <div className="flex gap-2">
              <Select name="status" defaultValue={f.status ?? ""} aria-label="Status" className="min-w-0 flex-1">
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="prospect">Prospect</option>
                <option value="on_hold">Credit hold</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Select name="segment" defaultValue={f.segment ?? ""} aria-label="Customer type" className="min-w-0 flex-1">
                <option value="">All types</option>
                {[...segLabels].map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              <button className={buttonClass("secondary", "md")} type="submit">
                Search
              </button>
            </div>
          </form>
          {rows.length === 0 ? (
            <EmptyState title={filtered ? "No customers match" : "No customers yet"} action={canCreate && !filtered ? <LinkButton href="/sales/customers/new">Add a customer</LinkButton> : undefined}>
              {filtered ? "Try other words, or clear the filters." : "Customers you add here can be chosen on quotations and customer orders."}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Customers">
              {rows.map((c) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <Link
                      href={keep({ c: c.id, tab: undefined })}
                      aria-current={active ? "true" : undefined}
                      className={cx(
                        "flex gap-3 rounded-[16px] border p-3 transition-colors",
                        active ? "border-[var(--info-bd)] bg-[var(--info-bg)]" : "border-line bg-surface hover:bg-surface-2",
                      )}
                    >
                      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-text" aria-hidden>
                        <UserRound size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-fg">{c.name}</span>
                        {(c.email || c.phone) && <span className="block truncate text-[12.5px] text-muted">{c.email ?? c.phone}</span>}
                        {c.outstanding !== undefined && Number(c.outstanding) > 0 && (
                          <span className="block text-[13px] text-fg-2">
                            <Money value={c.outstanding} /> owed
                          </span>
                        )}
                        <span className={cx("block text-[12.5px]", c.openOrders > 0 ? "font-medium text-primary-text" : "text-muted")}>
                          {c.openOrders} open order{c.openOrders === 1 ? "" : "s"}
                          {c.status !== "active" ? ` · ${c.status === "on_hold" ? "credit hold" : c.status}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: the selected customer (its own screen below 1024 px). */}
        <div className={cx("min-w-0", !showDetail && "hidden lg:block")}>
          {selected ? (
            <CustomerPanel ctx={ctx} d={selected} outstanding={owed ? (owed.get(selected.customer.id) ?? "0") : undefined} tab={tab} hrefFor={(t) => keep({ tab: t === "orders" ? undefined : t })} backHref={keep({ c: undefined, tab: undefined })} />
          ) : notFound ? (
            <EmptyState title="Customer not found" action={<LinkButton href={keep({ c: undefined, tab: undefined })} variant="secondary">All customers</LinkButton>}>
              This customer does not exist in your organization.
            </EmptyState>
          ) : (
            <EmptyState title="Choose a customer">Pick a customer on the left to see their orders, history and details.</EmptyState>
          )}
        </div>
      </div>
    </>
  );
}
