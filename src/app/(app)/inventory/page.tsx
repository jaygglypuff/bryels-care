import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext, type AuthContext } from "@/lib/auth/context";
import { getCurrentSiteLocation } from "@/modules/inventory/lots";
import { stockByItem } from "@/modules/inventory";
import { LOCATION_SECTIONS, SECTION_LABELS, isSection } from "@/lib/location-sections";
import { EmptyState, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { ListToolbar } from "@/ui/kit";
import { FilterSelect } from "@/ui/kit-client";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { STATUS_CHIPS, normaliseStockStatus } from "@/ui/inventory/item-status";
import { StockItemList, WhatIsALot } from "@/ui/inventory/stock-items";
import { StockSearch } from "@/ui/inventory/stock-search";
import { StockTabs } from "@/ui/inventory/stock-tabs";
import { Forbidden } from "../forbidden";

export const metadata = { title: "Stock" };

type SP = { q?: string; kind?: string; status?: string; loc?: string; section?: string };
type Kind = "material" | "product" | "all";

const TITLE: Record<Kind, string> = { material: "Raw materials", product: "Finished goods", all: "All stock" };
const NOUN: Record<Kind, string> = { material: "Material", product: "Product", all: "Item" };

/**
 * Stock (owner review 2026-10-30, brief Part II §3 mockup): one row per material or product, name first,
 * usable quantity, status in plain words and the next expiry; tap a row for its lots. One search box,
 * status chips as links, "More filters" for the warehouse section. Expired / rejected stock sits in a red
 * "Do not use" group at the bottom. Reads come from `stockByItem` (site-scoped, permission-checked).
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="lots and stock" permission="inventory.lot.view" />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = normaliseStockStatus(sp.status);
  const section = isSection(sp.section) ? sp.section : undefined;
  const loc = await getCurrentSiteLocation(ctx, sp.loc);
  // Raw materials is the first tab. Deep links that filter (old status links, words, a place) without a
  // kind keep showing every kind, so a link from Home never hides finished goods.
  const kind: Kind = sp.kind === "material" || sp.kind === "product" || sp.kind === "all" ? sp.kind : q || sp.status || section || loc ? "all" : "material";
  const keep = { kind, status, section, loc: loc?.id };
  const href = (over: Partial<Record<"kind" | "status" | "q" | "section" | "loc", string | undefined>>) => {
    const p = new URLSearchParams();
    const all = { kind, status, q: q || undefined, section, loc: loc?.id, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/inventory?${p.toString()}`;
  };

  const r = await stockByItem(ctx, { kind: kind === "all" ? undefined : kind, q, status, section, locationId: loc?.id });
  const total = r.items.length + r.doNotUse.length;

  return (
    <div className="space-y-4">
      {/* ADR-136: the title is the menu word (Stock); the kind of stock is the tab under it and the meta line. */}
      <PageHeader
        title="Stock"
        subtitle={`${ctx.currentSite.name} · ${TITLE[kind]} · ${total} ${total === 1 ? NOUN[kind].toLowerCase() : `${NOUN[kind].toLowerCase()}s`}`}
        actions={
          <>
            <MoreMenu>
              <div className="flex flex-col gap-2">
                {ctx.can("inventory.balance.view") && <LinkButton href="/inventory/availability" variant="secondary">Can we deliver?</LinkButton>}
                <LinkButton href="/inventory/lots/expiry" variant="secondary">Expiring soon</LinkButton>
                <LinkButton href="/inventory/lots/reservations" variant="secondary">Which one to use first / set aside</LinkButton>
                {ctx.can("inventory.movement.view") && <LinkButton href="/inventory/movements" variant="secondary">Stock changes</LinkButton>}
                {ctx.can("masterdata.location.view") && <LinkButton href="/inventory/locations" variant="secondary">Shelves</LinkButton>}
                {ctx.can("inventory.container.view") && <LinkButton href="/inventory/containers" variant="secondary">Boxes and sacks</LinkButton>}
              </div>
            </MoreMenu>
            {ctx.can("procurement.goods_receipt.create") && (
              <LinkButton href="/inventory/receive" variant="cta">
                <Plus size={16} aria-hidden /> Receive a delivery
              </LinkButton>
            )}
          </>
        }
      />
      <PageIntro>This screen is for seeing what is in stock, if it is OK to use, and when it expires. Tap a row to see its lots; the one that expires first is listed first.</PageIntro>

      {/* ADR-136: one toolbar: the kind tabs, the search box, and status and place as dropdowns (were pill rows and "More filters"). */}
      <ListToolbar tabs={<StockTabs active={kind} bare />}>
        <StockSearch defaultQ={q} keep={keep} />
        <FilterSelect
          id="stock-status"
          label="Status"
          value={status ?? ""}
          options={[
            ...STATUS_CHIPS.map((c) => ({ value: c.key, label: `${c.key ? c.label : "Every status"} (${c.key ? r.counts[c.key] : r.counts.all})`, href: href({ status: c.key || undefined }) })),
            ...(status === "do_not_use" ? [{ value: "do_not_use", label: "Do not use", href: href({ status: "do_not_use" }) }] : []),
          ]}
        />
        <FilterSelect
          id="section"
          label="Part of the warehouse"
          value={section ?? ""}
          options={[{ value: "", label: "Everywhere", href: href({ section: undefined }) }, ...LOCATION_SECTIONS.map((x) => ({ value: x, label: SECTION_LABELS[x], href: href({ section: x }) }))]}
        />
      </ListToolbar>

      {loc && (
        <Banner tone="info" title={`Showing stock stored at ${loc.name} (${loc.code})`} action={<Link href={href({ loc: undefined })} className={buttonClass("secondary", "sm")}>Show all places</Link>} />
      )}

      {/* No suspense boundary here (ADR-043); while a new list loads the search box dims and the top progress bar runs. */}
      <StockList r={r} ctx={ctx} kind={kind} q={q} status={status} section={section} locId={loc?.id} href={href} />

      <WhatIsALot />
    </div>
  );
}

async function StockList({ r, ctx, kind, q, status, section, locId, href }: { r: Awaited<ReturnType<typeof stockByItem>>; ctx: AuthContext; kind: Kind; q: string; status: ReturnType<typeof normaliseStockStatus>; section?: string; locId?: string; href: (o: Record<string, string | undefined>) => string }) {
  const narrowed = !!(q || status || section || locId);
  const noun = NOUN[kind].toLowerCase();
  // Words that hit a lot number or supplier lot open the rows, so the matching lot is visible at once.
  const openRows = !!q && r.items.length + r.doNotUse.length <= 5;
  return (
    <>
      {status && status !== "do_not_use" && (
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-2" data-testid="stock-filter-note">
          Showing only: <span className="font-semibold text-fg">{STATUS_CHIPS.find((c) => c.key === status)?.label}</span>
          <Link href={href({ status: undefined })} className="inline-flex min-h-[32px] items-center font-medium text-primary-text hover:underline pointer-coarse:min-h-[44px]">Show all</Link>
        </p>
      )}
      {status === "do_not_use" && (
        <Banner tone="bad" title="Showing only stock that must not be used" action={<Link href={href({ status: undefined })} className={buttonClass("secondary", "sm")}>Show all</Link>} />
      )}

      {r.items.length === 0 && r.doNotUse.length === 0 ? (
        <EmptyState
          title={narrowed ? `Nothing matches${q ? ` "${q}"` : " this filter"}` : kind === "product" ? "No finished goods in stock here yet" : kind === "material" ? "No raw materials in stock here yet" : "No stock at this site yet"}
          action={narrowed ? <LinkButton href={`/inventory?kind=${kind}`} variant="secondary">Show everything</LinkButton> : ctx.can("procurement.goods_receipt.create") ? <LinkButton href="/inventory/receive" variant="cta">Receive materials</LinkButton> : undefined}
        >
          {narrowed ? "Try fewer words, part of the lot number, or another status." : "Received materials and finished batches appear here: what is in stock, if it is OK to use, and when it expires."}
        </EmptyState>
      ) : (
        <>
          {r.items.length > 0 && (
            <section aria-label="Stock list" data-testid="stock-list">
              <StockItemList items={r.items} label={NOUN[kind]} open={openRows} />
              <p className="mt-1.5 px-1 text-[13px] text-fg-2">
                {r.items.length} {r.items.length === 1 ? noun : `${noun}s`} · open a row to see its lots
              </p>
            </section>
          )}
          {r.items.length === 0 && status !== "do_not_use" && (
            <p className="rounded-[8px] border border-line bg-surface px-4 py-3 text-[13px] text-fg-2">Nothing usable matches. Only stock that must not be used is listed below.</p>
          )}
          {r.doNotUse.length > 0 && (
            <section aria-labelledby="do-not-use" data-testid="stock-do-not-use" className="space-y-2 pt-2">
              <div>
                <h2 id="do-not-use" className="text-[15px] font-semibold text-[var(--bad-fg)]">Do not use · {r.doNotUse.length}</h2>
                <p className="text-[13px] text-fg-2">Expired, rejected or recalled. Keep it apart and ask quality what to do with it.</p>
              </div>
              <StockItemList items={r.doNotUse} blocked label={NOUN[kind]} open={openRows} />
            </section>
          )}
        </>
      )}
    </>
  );
}
