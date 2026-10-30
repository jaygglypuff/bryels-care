import Link from "next/link";
import { notFound } from "next/navigation";
import { PackagePlus, ScanLine, ShoppingCart, Factory } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getItemStock, type ItemStock } from "@/modules/inventory";
import { LinkButton, cx } from "@/ui/core";
import { Banner } from "@/ui/status";
import { WhatIsALot } from "@/ui/inventory/stock-items";
import { BigNumber, ExpiringList, LotList, MovementList, PlacesList, Quiet, Section, ShowMore, SupplierBrandTotals, SupplierList, TotalSentence } from "@/ui/inventory/item-page";
import { Forbidden } from "../../../../forbidden";

export const metadata = { title: "Item" };

/**
 * Item page (owner question 2026-10-30): everything about one material or product at the current site
 * (or all of the caller's sites with ?all=1 when allowed): how much, from whom, what expires first, where it
 * is, every lot in the order to use it, and what happened lately. Reads only, from `getItemStock`
 * (permission + site checks on the server).
 */
export default async function ItemPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="stock" />;
  const { kind, id } = await params;
  const sp = await searchParams;
  let r: ItemStock;
  try {
    r = await getItemStock(ctx, { kind, id, all: sp.all === "1" });
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const it = r.item;
  const isMat = it.kind === "material";
  const base = `/inventory/items/${it.kind}/${it.id}`;
  const where = r.scope.all ? "at all your plants" : `at ${ctx.currentSite.name}`;
  // Every number says where it counts (grade-5 test: Stock, Availability and Products disagreed because each counted a different place).
  const scopeTag = r.scope.all ? "all plants" : "this plant";
  const nothing = r.lots.length === 0;
  const blockedFirst = r.lots.length > 0 && r.lots[0].state !== "ok" && r.lots[0].state !== "expiring";
  const expiringAny = r.expiring.some((b) => b.lots.length > 0);
  const firstUsable = r.lots.find((l) => l.state === "ok" || l.state === "expiring");

  const actions = [
    isMat && ctx.can("procurement.goods_receipt.create") ? { href: "/inventory/receive", label: "Receive more", icon: <PackagePlus size={18} aria-hidden />, main: true } : null,
    isMat && ctx.can("procurement.reorder_suggestion.view") ? { href: "/procurement/reorder", label: "Order more", icon: <ShoppingCart size={18} aria-hidden />, main: false } : null,
    !isMat && ctx.can("production.work_order.view") ? { href: "/production/plan", label: "Plan more", icon: <Factory size={18} aria-hidden />, main: false } : null,
    ctx.can("inventory.movement.post") && !nothing ? { href: firstUsable && !r.scope.all ? `/inventory/move?lot=${firstUsable.lotId}` : "/inventory/move", label: "Scan to move", icon: <ScanLine size={18} aria-hidden />, main: false } : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  const fourth = r.minimum && r.belowMinimum
    ? <BigNumber label="Below minimum?" scope={scopeTag} value="Yes" tone="bad" hint={<>We should have at least {r.minimum.text}. Order or make more.</>} testId="item-card-minimum" />
    : <BigNumber label="Expiring soon" scope={scopeTag} value={r.totals.expiringSoon.text} tone={r.totals.expiringSoon.qty !== "0" ? "warn" : "neu"} hint={<>Expires in the next 30 days.{r.minimum ? ` Minimum ${r.minimum.text}: OK.` : ""}</>} testId="item-card-expiring" />;

  return (
    <div className="space-y-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          <Link href={`/inventory?kind=${it.kind}`} className="inline-flex min-h-[44px] items-center text-primary-text hover:underline">
            {isMat ? "Raw materials" : "Finished goods"}
          </Link>
        </nav>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-fg sm:text-[34px]">{it.name}</h1>
        <p className="mt-1 max-w-prose text-[15px] text-fg-2">Everything about {it.name}: how much we have, from whom, and what expires first.</p>
        <p className="mt-1 text-[12px] text-muted">
          {[it.group, it.usualBrand ? `usual brand ${it.usualBrand}` : null, it.shelfLifeDays ? `keeps about ${it.shelfLifeDays} days` : null, it.storageConditions, `code ${it.code}`].filter(Boolean).join(" · ")}
        </p>
      </div>

      {(r.scope.canAll || actions.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {r.scope.canAll ? (
            <nav aria-label="Which sites" className="inline-flex rounded-full border border-line bg-surface p-1 text-[14px]">
              <Link href={base} aria-current={!r.scope.all ? "true" : undefined} className={cx("inline-flex min-h-[40px] items-center rounded-full px-4", !r.scope.all ? "bg-[var(--brand-600)] font-semibold text-white" : "text-fg-2")}>
                This plant
              </Link>
              <Link href={`${base}?all=1`} aria-current={r.scope.all ? "true" : undefined} className={cx("inline-flex min-h-[40px] items-center rounded-full px-4", r.scope.all ? "bg-[var(--brand-600)] font-semibold text-white" : "text-fg-2")}>
                All plants
              </Link>
            </nav>
          ) : <span />}
          {actions.length > 0 && (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto" data-testid="item-actions">
              {actions.map((a) => (
                <LinkButton key={a.label} href={a.href} variant={a.main ? "cta" : "secondary"} className="flex-1 sm:flex-none">
                  {a.icon} {a.label}
                </LinkButton>
              ))}
            </div>
          )}
        </div>
      )}

      {nothing ? (
        <Section id="empty" title={`No ${it.name} ${where}`}>
          <Quiet>
            There is none in stock right now.{" "}
            {r.minimum ? `We should have at least ${r.minimum.text}. ` : ""}
            {isMat ? "When a delivery is received it shows up here." : "When a batch is finished it shows up here."}
          </Quiet>
        </Section>
      ) : (
        <>
          <section aria-label="How much we have" className="space-y-2">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <BigNumber
                label="Ready to use"
                scope={scopeTag}
                value={r.totals.ready.text}
                tone={r.totals.ready.qty !== "0" ? "ok" : "neu"}
                hint={r.totals.setAside.qty !== "0" ? <>{r.totals.setAside.text} set aside for {isMat ? "batches" : "orders"}. Free to use: <b>{r.totals.free.text}</b></> : "Passed the QA check and not expired."}
                testId="item-card-ready"
              />
              <BigNumber label="Waiting for QA check" scope={scopeTag} value={r.totals.waiting.text} tone={r.totals.waiting.qty !== "0" ? "q" : "neu"} hint="QA must check it before we use it." testId="item-card-waiting" />
              <BigNumber label="Stopped by QA" scope={scopeTag} value={r.totals.onHold.text} tone={r.totals.onHold.qty !== "0" ? "hold" : "neu"} hint="Do not use it until QA says yes." testId="item-card-hold" />
              {fourth}
            </div>
            <TotalSentence totals={r.totals} lots={r.lots.length} where={where} />
            {r.orders && (
              <div className="grid grid-cols-1 gap-2 rounded-[16px] border border-line bg-surface p-3 text-[14px] sm:grid-cols-3" data-testid="item-orders">
                <p>
                  <span className="block text-[12px] text-muted">Promised to customer orders ({scopeTag})</span>
                  <b className="tabular">{r.totals.promised.text}</b>
                </p>
                <p>
                  <span className="block text-[12px] text-muted">Ordered by customers, not yet set aside</span>
                  <b className="tabular">{r.orders.notSetAside.text}</b>
                </p>
                <p>
                  <span className="block text-[12px] text-muted">Free to sell (ready, minus set aside and ordered)</span>
                  <b className="tabular text-[var(--ok-fg)]">{r.orders.freeToSell.text}</b>
                </p>
              </div>
            )}
          </section>

          {blockedFirst && <Banner tone="warn" title="Nothing is ready to use right now">The lots below are waiting for the QA check, stopped by QA, or must not be used.</Banner>}

          <Section id="suppliers" title={isMat ? "Who we bought it from" : "Which batches made it"} hint={isMat ? "Each supplier and brand, how much we have, and what expires first." : "Each batch, how much is left, and when it expires."}>
            {isMat && <SupplierBrandTotals bySupplier={r.bySupplierTotal} byBrand={r.byBrandTotal} />}
            <ShowMore items={r.bySupplier} first={isMat ? 6 : 5} noun={isMat ? "suppliers and brands" : "batches"} render={(rows) => <SupplierList rows={rows} kind={it.kind} />} />
          </Section>

          <Section id="expiring" title="Use these first (expiring soon)" hint="Lots that expire in the next 90 days, and lots that already expired.">
            {expiringAny ? <ExpiringList buckets={r.expiring} kind={it.kind} /> : <Quiet>Good news: nothing expires in the next 90 days.</Quiet>}
          </Section>

          <Section id="where" title="Where it is" hint="How much is on each shelf, by part of the warehouse.">
            <PlacesList places={r.places} showSite={r.scope.all} />
          </Section>

          <Section id="lots" title="All lots" hint="In the order to use them: ready ones first, the one that expires first at the top." action={<WhatIsALot />}>
            <ShowMore items={r.lots} first={isMat ? 8 : 5} noun="lots" render={(rows, offset) => <LotList lots={rows} kind={it.kind} showSite={r.scope.all} offset={offset} />} />
          </Section>
        </>
      )}

      <Section id="history" title="What happened lately" hint="The last things that happened to this item.">
        {r.movements.length === 0 ? <Quiet>Nothing has happened to it yet.</Quiet> : <MovementList movements={r.movements} showLink={r.movements.length >= 10} />}
      </Section>
    </div>
  );
}
