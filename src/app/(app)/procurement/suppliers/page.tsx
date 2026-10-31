import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listSuppliers } from "@/modules/masterdata";
import { listAslQueue } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav, SupplierChip } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers we may buy from" };

/** Approved-supplier list (US-6-01, W04-11): what waits for QA, then every supplier by name. */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" />;
  const { q } = await searchParams;
  const [queue, sups] = await Promise.all([listAslQueue(ctx), listSuppliers(ctx)]);
  const needle = (q ?? "").trim().toLowerCase();
  const shown = needle ? sups.filter((s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle)) : sups;
  const canDecide = ctx.can("masterdata.supplier.approve");
  const mine = queue.filter((x) => x.proposedBy !== ctx.userId);
  return (
    <>
      {/* UX audit R2: the one supplier entry in the menu; adding a supplier and its address book live in Master data. */}
      <PageHeader title="Suppliers we may buy from" actions={ctx.can("masterdata.supplier.create") ? <LinkButton href="/masterdata/suppliers/new" variant="secondary">New supplier</LinkButton> : undefined} />
      <PageIntro>This screen is for which items we may buy from which supplier. Purchasing suggests a supplier for an item; QA says yes or no. Only “yes” items can go on a purchase order.</PageIntro>
      {canDecide && mine.length > 0 && <NextStep text={`Next: ${mine.length} suggestion(s) wait for a QA decision.`} action={{ label: "Open the first", href: `/procurement/suppliers/${mine[0].supplierId}` }} />}
      <SubNav />
      <div className="flex flex-col gap-5">
        {queue.length > 0 && (
          <Card>
            <CardTitle>Waiting for QA</CardTitle>
            <PlainList label="Waiting for QA">
              {queue.map((x) => (
                <PlainRow
                  key={x.id}
                  href={`/procurement/suppliers/${x.supplierId}`}
                  title={`${x.supplierName} · ${x.materialName}`}
                  code={x.materialCode}
                  status={<Chip tone={x.action === "suspend" ? "warn" : "appr"}>{x.action === "suspend" ? "Stop buying – QA to decide" : "Start buying – QA to decide"}</Chip>}
                  facts={`Suggested by ${x.proposedByName}, ${fmtDate(x.proposedAt)}${x.note ? ` · ${x.note}` : ""}`}
                />
              ))}
            </PlainList>
          </Card>
        )}
        <Card>
          <CardTitle>All suppliers</CardTitle>
          <form method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="s-q" className="sr-only">Find a supplier</label>
            <input id="s-q" name="q" defaultValue={q ?? ""} placeholder="Type part of the supplier's name" autoComplete="off" className="min-h-[44px] min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[15px]" />
            <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-[14px] font-medium hover:bg-surface-2">Find</button>
          </form>
          {sups.length === 0 ? (
            <EmptyState title="No suppliers yet">{ctx.can("masterdata.supplier.create") ? "Add the first one with New supplier." : "Ask purchasing or the administrator to add one."}</EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState title="No supplier with that name">Try fewer letters.</EmptyState>
          ) : (
            <PlainList label="Suppliers">
              {shown.map((s) => (
                <PlainRow
                  key={s.id}
                  href={`/procurement/suppliers/${s.id}`}
                  title={s.name}
                  code={s.code}
                  status={<SupplierChip status={s.qualityStatus} />}
                  facts={`${s.defaultLeadTimeDays !== null ? `Takes about ${s.defaultLeadTimeDays} day(s) to deliver` : "Delivery time not set"} · ${s.receipts} deliver${s.receipts === 1 ? "y" : "ies"}`}
                />
              ))}
            </PlainList>
          )}
        </Card>
      </div>
    </>
  );
}
