import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext, type AuthContext } from "@/lib/auth/context";
import { getCurrentSiteLocation } from "@/modules/inventory/lots";
import { stockByItem } from "@/modules/inventory";
import { LOCATION_SECTIONS, SECTION_LABELS, isSection } from "@/lib/location-sections";
import { Card, EmptyState, LinkButton, PageHeader, Select, buttonClass, cx } from "@/ui/core";
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
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="lots and stock" />;
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={TITLE[kind]}
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {ctx.can("procurement.goods_receipt.create") && (
              <LinkButton href="/inventory/receive" variant="cta">
                <Plus size={18} aria-hidden /> Receive a delivery
              </LinkButton>
            )}
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
          </>
        }
      />
      <PageIntro>This screen is for seeing what is in stock, if it is OK to use, and when it expires. Tap a row to see its lots; the one that expires first is listed first.</PageIntro>
      <StockTabs active={kind} />

      <StockSearch defaultQ={q} keep={keep} />

      {/* No suspense boundary here (ADR-043); while a new list loads the search box dims and the top progress bar runs. */}
      <StockList ctx={ctx} kind={kind} q={q} status={status} section={section} locId={loc?.id} href={href} />

      {loc && (
        <Banner tone="info" title={`Showing stock stored at ${loc.name} (${loc.code})`} action={<Link href={href({ loc: undefined })} className={buttonClass("secondary", "sm")}>Show all places</Link>} />
      )}

      <div className="flex flex-wrap items-start gap-x-6">
        <WhatIsALot />
        <details className="text-[13px]" open={!!section}>
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-medium text-primary-text">More filters{section ? ` · ${SECTION_LABELS[section]}` : ""}</summary>
          <form method="get" action="/inventory" className="flex flex-wrap items-end gap-2 pb-2">
            <input type="hidden" name="kind" value={kind} />
            {status && <input type="hidden" name="status" value={status} />}
            {q && <input type="hidden" name="q" value={q} />}
            {loc && <input type="hidden" name="loc" value={loc.id} />}
            <div className="flex flex-col gap-1">
              <label htmlFor="section" className="text-[13px] font-medium">Part of the warehouse</label>
              <Select id="section" name="section" defaultValue={section ?? ""}>
                <option value="">Everywhere</option>
                {LOCATION_SECTIONS.map((s) => (
                  <option key={s} value={s}>{SECTION_LABELS[s]}</option>
                ))}
              </Select>
            </div>
            <button type="submit" className={buttonClass("secondary")}>Show</button>
            {section && <Link href={href({ section: undefined })} className={buttonClass("ghost")}>Everywhere</Link>}
          </form>
        </details>
      </div>
    </div>
  );
}

async function StockList({ ctx, kind, q, status, section, locId, href }: { ctx: AuthContext; kind: Kind; q: string; status: ReturnType<typeof normaliseStockStatus>; section?: string; locId?: string; href: (o: Record<string, string | undefined>) => string }) {
  const r = await stockByItem(ctx, { kind: kind === "all" ? undefined : kind, q, status, section, locationId: locId });
  const narrowed = !!(q || status || section || locId);
  const noun = NOUN[kind].toLowerCase();
  // Words that hit a lot number or supplier lot open the rows, so the matching lot is visible at once.
  const openRows = !!q && r.items.length + r.doNotUse.length <= 5;
  return (
    <>
      <nav aria-label="Filter by status" className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="flex gap-2">
          {STATUS_CHIPS.map((c) => {
            const active = (status ?? "") === c.key;
            const n = c.key ? r.counts[c.key] : r.counts.all;
            return (
              <li key={c.key || "all"} className="shrink-0">
                <Link
                  href={href({ status: c.key || undefined })}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium whitespace-nowrap",
                    active ? "border-[var(--brand-600)] bg-[var(--brand-600)] text-white" : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
                  )}
                >
                  {c.label}
                  <span className={cx("tabular text-[12px]", active ? "text-white/85" : "text-muted")}>{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {status && status !== "do_not_use" && (
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-2" data-testid="stock-filter-note">
          Showing only: <span className="font-semibold text-fg">{STATUS_CHIPS.find((c) => c.key === status)?.label}</span>
          <Link href={href({ status: undefined })} className="inline-flex min-h-[44px] items-center font-medium text-primary-text underline-offset-2 hover:underline">Show all</Link>
        </p>
      )}
      {status === "do_not_use" && (
        <Banner tone="bad" title="Showing only stock that must not be used" action={<Link href={href({ status: undefined })} className={buttonClass("secondary", "sm")}>Show all</Link>} />
      )}

      {r.items.length === 0 && r.doNotUse.length === 0 ? (
        <Card>
          <EmptyState
            title={narrowed ? `Nothing matches${q ? ` "${q}"` : " this filter"}` : kind === "product" ? "No finished goods in stock here yet" : kind === "material" ? "No raw materials in stock here yet" : "No stock at this site yet"}
            action={narrowed ? <LinkButton href={`/inventory?kind=${kind}`} variant="secondary">Show everything</LinkButton> : ctx.can("procurement.goods_receipt.create") ? <LinkButton href="/inventory/receive" variant="cta">Receive materials</LinkButton> : undefined}
          >
            {narrowed ? "Try fewer words, part of the lot number, or another status." : "Received materials and finished batches appear here."}
          </EmptyState>
        </Card>
      ) : (
        <>
          {r.items.length > 0 && (
            <section aria-label="Stock list" data-testid="stock-list">
              <StockItemList items={r.items} label={NOUN[kind]} open={openRows} />
              <p className="mt-1.5 px-1 text-[12px] text-muted">
                {r.items.length} {r.items.length === 1 ? noun : `${noun}s`}. Tap a row to see its lots.
              </p>
            </section>
          )}
          {r.items.length === 0 && status !== "do_not_use" && (
            <p className="rounded-[12px] border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted">Nothing usable matches. Only stock that must not be used is listed below.</p>
          )}
          {r.doNotUse.length > 0 && (
            <section aria-labelledby="do-not-use" data-testid="stock-do-not-use" className="space-y-2 pt-2">
              <div>
                <h2 id="do-not-use" className="text-[16px] font-semibold text-[var(--bad-fg)]">Do not use · {r.doNotUse.length}</h2>
                <p className="text-[12px] text-muted">Expired, rejected or recalled. Keep it apart and ask quality what to do with it.</p>
              </div>
              <StockItemList items={r.doNotUse} blocked label={NOUN[kind]} open={openRows} />
            </section>
          )}
        </>
      )}
    </>
  );
}
