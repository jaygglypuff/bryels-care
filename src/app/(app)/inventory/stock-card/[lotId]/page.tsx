import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { type StockCard, getStockCard, manilaToday } from "@/modules/inventory";
import { Card, Dl, EmptyState, Input, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { MOVEMENT_LABEL, fmtLotQty } from "@/ui/inventory/bits";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { PrintButton } from "./print-button";

export const metadata = { title: "Stock card" };

type Search = { from?: string; to?: string; location?: string };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgo(n: number) {
  const d = new Date(`${manilaToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function StockCardPage({ params, searchParams }: { params: Promise<{ lotId: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.view")) return <Forbidden what="stock cards" />;
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
          <PageHeader title="Stock card" />
          <Banner tone="warn" title="Check the dates">{e.message}</Banner>
          <Link href={`/inventory/stock-card/${lotId}`} className={buttonClass("secondary")}>Reset dates</Link>
        </div>
      );
    }
    throw e;
  }
  const uom = card.lot.baseUom;
  const qs = new URLSearchParams({ from, to, ...(locationId ? { locationId } : {}) });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Stock card · ${card.lot.lotNumber}`}
        subtitle={`${card.lot.itemName} (${card.lot.itemCode}) · ${card.location ? `location ${card.location.code}` : "all locations"} · ${fmtDate(from)} to ${fmtDate(to)}`}
        actions={
          <>
            <Link href={`/inventory/${card.lot.id}`} className={buttonClass("secondary", "sm")}>Lot detail</Link>
            {ctx.can("inventory.movement.export") && (
              <>
                <a className={buttonClass("secondary", "sm")} href={`/api/v1/inventory/lots/${card.lot.id}/stock-card/export?${qs}&format=csv`}>Export CSV</a>
                <a className={buttonClass("secondary", "sm")} href={`/api/v1/inventory/lots/${card.lot.id}/stock-card/export?${qs}&format=xlsx`}>Export XLSX</a>
              </>
            )}
            <PrintButton />
          </>
        }
      />
      <form className="no-print grid gap-3 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-card)] sm:grid-cols-[1fr_1fr_auto]">
        {locationId && <input type="hidden" name="location" value={locationId} />}
        <div>
          <label htmlFor="from" className="text-[12px] text-muted">From</label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <label htmlFor="to" className="text-[12px] text-muted">To</label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <button className={buttonClass("primary") + " self-end"}>Show</button>
      </form>

      <Card>
        <Dl
          items={[
            ["Current status", <StatusChip key="s" status={card.lot.qualityStatus} />],
            ["Expires", card.lot.expiresOn ? fmtDate(card.lot.expiresOn) : "No expiry"],
            ["Opening balance", fmtLotQty(card.opening, uom)],
            ["Closing balance", fmtLotQty(card.closing, uom)],
            ["Movements in range", String(card.lines.length)],
            ["Scope", card.location ? card.location.code : "All locations of the lot"],
          ]}
        />
      </Card>

      {card.check.flagged ? (
        <Banner tone="bad" title="Ledger and balance projection differ">
          The ledger sums to {fmtLotQty(card.check.ledgerNow, uom)} but the balance shows {fmtLotQty(card.check.projection, uom)} (difference {card.check.difference} {uom}). Tell your system administrator; nothing is corrected automatically.
        </Banner>
      ) : (
        <p className="text-[12px] text-muted">Projection check: the current balance ({fmtLotQty(card.check.projection, uom)}) equals the ledger.</p>
      )}

      <Card>
        {card.lines.length === 0 ? (
          <EmptyState title="No movements in this period">Opening and closing balance are {fmtLotQty(card.opening, uom)}. Widen the date range to see earlier postings.</EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table head={["When", "Number", "Type", "From → to", "In", "Out", "Balance", "Status", "Source", "By / reason"]}>
                <tr className="bg-surface-2/60">
                  <Td colSpan={6} className="font-medium">Opening balance {fmtDate(from)}</Td>
                  <Td className="text-right font-semibold">{fmtLotQty(card.opening, uom)}</Td>
                  <Td colSpan={3} />
                </tr>
                {card.lines.map((l) => (
                  <tr key={l.movementId} className="hover:bg-surface-2">
                    <Td className="whitespace-nowrap">{fmtDateTime(l.postedAt)}</Td>
                    <Td><Link className="font-mono text-[12px] text-primary-text hover:underline" href={`/inventory/movements/${l.movementId}`}>{l.number}</Link></Td>
                    <Td>
                      {MOVEMENT_LABEL[l.movementType] ?? l.movementType}
                      {l.reversalOf && <div><Chip tone="warn">reverses {l.reversalOf}</Chip></div>}
                      {l.reversedBy && <div><Chip tone="neu">reversed</Chip></div>}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-[12px]">{l.fromCode ?? "—"} → {l.toCode ?? "—"}</Td>
                    <Td className="text-right">{l.qtyIn ? fmtLotQty(l.qtyIn, uom) : l.qtyMoved ? <span className="text-muted">moved {fmtLotQty(l.qtyMoved, uom)}</span> : ""}</Td>
                    <Td className="text-right">{l.qtyOut ? fmtLotQty(l.qtyOut, uom) : ""}</Td>
                    <Td className="text-right font-semibold">{fmtLotQty(l.running, uom)}</Td>
                    <Td>{l.statusAtPosting ? <StatusChip status={l.statusAtPosting} /> : <span className="text-muted">—</span>}</Td>
                    <Td>{l.sourceHref ? <Link className="text-primary-text hover:underline" href={l.sourceHref}>{l.sourceDocumentNumber}</Link> : (l.sourceDocumentNumber ?? "—")}</Td>
                    <Td>{l.postedBy}{l.reason && <div className="max-w-[240px] truncate text-[12px] text-muted" title={l.reason}>{l.reason}</div>}</Td>
                  </tr>
                ))}
                <tr className="bg-surface-2/60">
                  <Td colSpan={6} className="font-medium">Closing balance {fmtDate(to)}</Td>
                  <Td className="text-right font-semibold">{fmtLotQty(card.closing, uom)}</Td>
                  <Td colSpan={3} />
                </tr>
              </Table>
            </div>
            <ul className="space-y-3 md:hidden">
              <li className="rounded-[14px] bg-surface-2 p-3 text-[13px]">Opening {fmtDate(from)}: <strong>{fmtLotQty(card.opening, uom)}</strong></li>
              {card.lines.map((l) => (
                <li key={l.movementId} className="rounded-[14px] border border-line p-3 text-[13px]">
                  <div className="flex justify-between gap-2">
                    <Link className="font-mono text-primary-text" href={`/inventory/movements/${l.movementId}`}>{l.number}</Link>
                    <span className="text-muted">{fmtDateTime(l.postedAt)}</span>
                  </div>
                  <p>{MOVEMENT_LABEL[l.movementType] ?? l.movementType} · {l.fromCode ?? "—"} → {l.toCode ?? "—"}</p>
                  <p className="tabular">
                    {l.qtyIn && `In ${fmtLotQty(l.qtyIn, uom)} `}
                    {l.qtyOut && `Out ${fmtLotQty(l.qtyOut, uom)} `}
                    {l.qtyMoved && `Moved ${fmtLotQty(l.qtyMoved, uom)} `}· balance <strong>{fmtLotQty(l.running, uom)}</strong>
                  </p>
                  {(l.reversalOf || l.reversedBy) && <p className="text-[12px] text-[var(--warn-fg)]">{l.reversalOf ? `Reverses ${l.reversalOf}` : "Reversed"}</p>}
                </li>
              ))}
              <li className="rounded-[14px] bg-surface-2 p-3 text-[13px]">Closing {fmtDate(to)}: <strong>{fmtLotQty(card.closing, uom)}</strong></li>
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
