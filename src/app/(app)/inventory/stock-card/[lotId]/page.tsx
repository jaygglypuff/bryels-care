import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { type StockCard, getStockCard, manilaToday } from "@/modules/inventory";
import { Card, Dl, EmptyState, Input, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { LotStatusChip, MovementChip, fmtLotQty, placeWords } from "@/ui/inventory/bits";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { PrintButton } from "./print-button";

export const metadata = { title: "History of this lot" };

type Search = { from?: string; to?: string; location?: string };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgo(n: number) {
  const d = new Date(`${manilaToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * History of this lot (the stock card), grade-5 (ADR-088): one list for phone and desktop, each stock
 * change with what happened, in or out, and how much was left after it. Opening and closing amounts at
 * the top and bottom; the ledger check stays visible. Exports and print in ⋯ More.
 */
export default async function StockCardPage({ params, searchParams }: { params: Promise<{ lotId: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.view")) return <Forbidden what="the history of lots" />;
  const { lotId } = await params;
  const sp = await searchParams;
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : daysAgo(90);
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : manilaToday();
  const locationId = sp.location || null;

  let card: StockCard;
  try {
    card = await getStockCard(ctx, { lotId, from, to, locationId });
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    if (e instanceof DomainError && e.code === "validation") {
      return (
        <div className="space-y-4">
          <PageHeader title="History of this lot" />
          <PageIntro>This screen is for seeing everything that happened to one lot between two dates.</PageIntro>
          <Banner tone="warn" title="Check the dates">{e.message}</Banner>
          <Link href={`/inventory/stock-card/${lotId}`} className={buttonClass("secondary")}>Use the last 90 days</Link>
        </div>
      );
    }
    throw e;
  }
  const uom = card.lot.baseUom;
  const qs = new URLSearchParams({ from, to, ...(locationId ? { locationId } : {}) });

  return (
    <div className="space-y-4">
      <PageHeader
        title={`History: ${card.lot.itemName}`}
        subtitle={
          <>
            Lot <RecordNo>{card.lot.lotNumber}</RecordNo> · {card.location ? `only ${card.location.name}` : "all shelves"} · {fmtDate(from)} to {fmtDate(to)}
          </>
        }
        actions={
          <>
            <LinkButton href={`/inventory/${card.lot.id}`} variant="secondary">Open this lot</LinkButton>
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <PrintButton />
                {ctx.can("inventory.movement.export") && (
                  <>
                    <a className={buttonClass("secondary")} href={`/api/v1/inventory/lots/${card.lot.id}/stock-card/export?${qs}&format=xlsx`}>Download for Excel</a>
                    <a className={buttonClass("secondary")} href={`/api/v1/inventory/lots/${card.lot.id}/stock-card/export?${qs}&format=csv`}>Download as CSV</a>
                  </>
                )}
                {card.location && <LinkButton href={`/inventory/stock-card/${card.lot.id}?from=${from}&to=${to}`} variant="secondary">Show all shelves</LinkButton>}
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for seeing everything that happened to one lot between two dates: what came in, what went out, and how much was left after each change.</PageIntro>

      <form className="no-print grid grid-cols-2 gap-3 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-card)] sm:grid-cols-[1fr_1fr_auto]">
        {locationId && <input type="hidden" name="location" value={locationId} />}
        <div>
          <label htmlFor="from" className="text-[13px] font-medium">From</label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <label htmlFor="to" className="text-[13px] font-medium">To</label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <button className={buttonClass("secondary") + " col-span-2 self-end sm:col-span-1"}>Show these dates</button>
      </form>

      <Card>
        <Dl
          items={[
            ["Now", <LotStatusChip key="s" status={card.lot.qualityStatus} expiresOn={card.lot.expiresOn} />],
            ["Expires", card.lot.expiresOn ? fmtDate(card.lot.expiresOn) : "No expiry"],
            [`At the start (${fmtDate(from)})`, fmtLotQty(card.opening, uom)],
            [`At the end (${fmtDate(to)})`, <strong key="c">{fmtLotQty(card.closing, uom)}</strong>],
            ["Stock changes", String(card.lines.length)],
          ]}
        />
      </Card>

      {card.check.flagged ? (
        <Banner tone="bad" title="The history and the stock amount do not match">
          The history adds up to {fmtLotQty(card.check.ledgerNow, uom)} but the stock amount shows {fmtLotQty(card.check.projection, uom)} (difference {card.check.difference} {uom}). Tell your system administrator; nothing is fixed automatically.
        </Banner>
      ) : (
        <p className="text-[13px] text-muted">Checked: the stock amount now ({fmtLotQty(card.check.projection, uom)}) matches this history.</p>
      )}

      {card.lines.length === 0 ? (
        <Card>
          <EmptyState title="Nothing happened in these dates">At the start and at the end there was {fmtLotQty(card.opening, uom)}. Choose an earlier From date to see older stock changes.</EmptyState>
        </Card>
      ) : (
        <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="Stock changes of this lot">
          <li className="bg-surface-2/60 px-4 py-3 text-[14px]">At the start ({fmtDate(from)}): <strong className="tabular">{fmtLotQty(card.opening, uom)}</strong></li>
          {card.lines.map((l) => {
            const amount = l.qtyIn ? `+ ${fmtLotQty(l.qtyIn, uom)}` : l.qtyOut ? `− ${fmtLotQty(l.qtyOut, uom)}` : l.qtyMoved ? `moved ${fmtLotQty(l.qtyMoved, uom)}` : "";
            const where = placeWords(l.fromName ?? l.fromCode, l.toName ?? l.toCode);
            return (
              <li key={l.movementId}>
                <Link href={`/inventory/movements/${l.movementId}`} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <MovementChip type={l.movementType} />
                      {l.reversalOf && <span className="text-[12px] text-[var(--warn-fg)]">undoes an earlier change</span>}
                      {l.reversedBy && <span className="text-[12px] text-muted">(undone)</span>}
                    </div>
                    <p className="mt-0.5 break-words text-[13px] text-fg-2">
                      {where && `${where} · `}
                      {l.postedBy} · {fmtDateTime(l.postedAt)}
                      <span className="ml-1 font-mono text-[12px] text-muted">· {l.number}</span>
                      {l.reason && <span className="block text-[12px] text-muted">“{l.reason}”</span>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular text-[15px]">{amount}</p>
                    <p className="text-[12px] text-muted tabular">left {fmtLotQty(l.running, uom)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
          <li className="bg-surface-2/60 px-4 py-3 text-[14px]">At the end ({fmtDate(to)}): <strong className="tabular">{fmtLotQty(card.closing, uom)}</strong></li>
        </ol>
      )}
    </div>
  );
}
