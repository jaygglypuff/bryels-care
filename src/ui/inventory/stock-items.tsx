import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Lock, PauseCircle, TrendingDown, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { ItemState, StockItem } from "@/modules/inventory/stock-by-item";
import { fmtDate } from "@/lib/qty";
import { cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { ITEM_STATE_LABEL } from "./item-status";

/**
 * Stock list, one row per item (owner review 2026-10-30; brief mockup "Inventory Management"). Rows are
 * native <details>: tap to see the lots behind the total, no JavaScript needed. Pure presentation of
 * the server read model `stockByItem`.
 */

type Tone = "ok" | "warn" | "bad" | "q" | "hold" | "exp" | "rej";
const STATE_LOOK: Record<ItemState, { tone: Tone; icon: ReactNode }> = {
  ok: { tone: "ok", icon: <CheckCircle2 size={13} aria-hidden /> },
  expiring: { tone: "warn", icon: <Clock size={13} aria-hidden /> },
  waiting: { tone: "q", icon: <Lock size={13} aria-hidden /> },
  on_hold: { tone: "hold", icon: <PauseCircle size={13} aria-hidden /> },
  low: { tone: "warn", icon: <TrendingDown size={13} aria-hidden /> },
  expired: { tone: "exp", icon: <Clock size={13} aria-hidden /> },
  rejected: { tone: "rej", icon: <XCircle size={13} aria-hidden /> },
  recalled: { tone: "bad", icon: <AlertTriangle size={13} aria-hidden /> },
};

export function ItemStateChip({ state }: { state: ItemState }) {
  const l = STATE_LOOK[state];
  return (
    <Chip tone={l.tone}>
      {l.icon}
      {ITEM_STATE_LABEL[state]}
    </Chip>
  );
}

function Avatar({ name, kind, blocked }: { name: string; kind: string; blocked?: boolean }) {
  const letter = (name.match(/\p{L}/u)?.[0] ?? name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-[12px] text-[16px] font-semibold",
        blocked ? "bg-[var(--bad-bg)] text-[var(--bad-fg)]" : kind === "product" ? "bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "bg-[var(--info-bg)] text-[var(--info-fg)]",
      )}
    >
      {letter}
    </span>
  );
}

function ExpiryText({ date, days }: { date: string | null; days: number | null }) {
  if (!date) return <span className="text-muted">No expiry date</span>;
  const tone = days !== null && days < 0 ? "text-[var(--bad-fg)] font-semibold" : days !== null && days <= 30 ? "text-[var(--warn-fg)] font-semibold" : "text-fg-2";
  const left = days === null ? "" : days < 0 ? ` · expired ${-days} ${-days === 1 ? "day" : "days"} ago` : days === 0 ? " · expires today" : ` · ${days} ${days === 1 ? "day" : "days"} left`;
  return (
    <span className={cx("whitespace-nowrap", tone)}>
      {fmtDate(date)}
      <span className="text-[12px]">{left}</span>
    </span>
  );
}

function QtyBlock({ item, blocked }: { item: StockItem; blocked: boolean }) {
  if (blocked) return <span className="font-semibold tabular">{item.totalText}</span>;
  const extra = [item.waitingText ? `${item.waitingText} waiting for check` : null, item.onHoldText ? `${item.onHoldText} on hold` : null].filter(Boolean);
  return (
    <span className="block">
      <span className="text-[16px] font-semibold tabular">{item.usableText}</span> <span className="text-[12px] text-muted">OK to use</span>
      {extra.length > 0 && <span className="block text-[12px] text-fg-2">+ {extra.join(" · ")}</span>}
      {item.low && item.minimumText && <span className="block text-[12px] text-[var(--warn-fg)]">Below the minimum of {item.minimumText}</span>}
    </span>
  );
}

const COLS = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_24px]";

function LotLines({ item }: { item: StockItem }) {
  return (
    <ul className="divide-y divide-line">
      {item.lots.map((l) => (
        <li key={l.lotId} className={cx("grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 py-2.5 text-[13px] lg:items-center", COLS)}>
          <span className="min-w-0 pl-[52px]">
            <span className="text-muted">Lot </span>
            <Link href={`/inventory/${l.lotId}`} className="font-mono font-semibold text-primary-text underline-offset-2 hover:underline">{l.lotNumber}</Link>
            <span className="block text-[12px] text-fg-2">
              At {l.where}
              {l.supplierName ? <> · from <span className="font-medium text-fg">{l.supplierName}</span></> : null}
              {l.brand ? ` · brand ${l.brand}` : null}
              {l.supplierLotNumber ? <span className="text-muted"> · their lot {l.supplierLotNumber}</span> : null}
            </span>
          </span>
          <span className="justify-self-end lg:justify-self-start"><ItemStateChip state={l.state} /></span>
          <span className="col-span-2 pl-[52px] font-medium tabular lg:col-span-1 lg:pl-0">{l.qtyText}</span>
          <span className="col-span-2 pl-[52px] lg:col-span-1 lg:pl-0"><ExpiryText date={l.expiresOn} days={l.daysLeft} /></span>
        </li>
      ))}
    </ul>
  );
}

/** One expandable row. `open` = show the lots at once (used when the words match a lot). */
function ItemRow({ item, blocked, open }: { item: StockItem; blocked: boolean; open: boolean }) {
  const head = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={item.name} kind={item.kind} blocked={blocked} />
        <span className="min-w-0">
          {/* The name opens the item page (totals, suppliers, expiry, every lot); the rest of the row opens the lots. */}
          <Link href={`/inventory/items/${item.kind}/${item.id}`} className="block text-[15px] font-semibold leading-snug text-fg underline decoration-line-strong underline-offset-4 hover:text-primary-text hover:decoration-current" data-testid="stock-item-link">
            {item.name}
          </Link>
          <span className="block text-[12px] text-muted">{item.code}{item.lots.length > 0 ? ` · ${item.lots.length} ${item.lots.length === 1 ? "lot" : "lots"}` : ""}</span>
        </span>
      </span>
      <span className="col-start-2 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto lg:justify-self-start">
        <ItemStateChip state={item.state} />
        {item.low && item.state !== "low" && <span className="ml-1 hidden lg:inline"><ItemStateChip state="low" /></span>}
      </span>
      <span className="col-span-2 pl-[52px] lg:col-span-1 lg:pl-0"><QtyBlock item={item} blocked={blocked} /></span>
      <span className="col-span-2 pl-[52px] text-[13px] lg:col-span-1 lg:pl-0">
        {item.lots.length === 0 ? <span className="text-muted">None in stock here</span> : item.nearestExpiry ? <><span className="text-muted lg:hidden">{blocked ? "Expiry " : "Next expiry "}</span><ExpiryText date={item.nearestExpiry} days={item.nearestDaysLeft} /></> : <span className="text-muted">No expiry date</span>}
      </span>
    </>
  );
  const grid = cx("grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1.5 lg:items-center", COLS);
  if (item.lots.length === 0) {
    return (
      <li className={cx(grid, "px-3 py-3 lg:px-4")} data-testid="stock-item" data-item-code={item.code}>
        {head}
        <span className="hidden lg:block" />
      </li>
    );
  }
  return (
    <li data-testid="stock-item" data-item-code={item.code}>
      <details className="group" open={open}>
        <summary className={cx(grid, "cursor-pointer list-none px-3 py-3 hover:bg-surface-2 lg:px-4 [&::-webkit-details-marker]:hidden")}>
          {head}
          <ChevronDown size={18} className="hidden text-muted transition-transform group-open:rotate-180 lg:block" aria-hidden />
          <span className="col-span-2 pl-[52px] text-[12px] font-medium text-primary-text lg:hidden">
            <span className="group-open:hidden">Show {item.lots.length === 1 ? "the lot" : `the ${item.lots.length} lots`}</span>
            <span className="hidden group-open:inline">Hide lots</span>
          </span>
        </summary>
        <div className="border-t border-line bg-surface-2/50 px-3 pb-2 lg:px-4">
          <TotalLine item={item} />
          {!blocked && item.lots.length > 1 && <p className="pl-[52px] pt-2 text-[12px] text-muted">Use the top one first: it expires first.</p>}
          <LotLines item={item} />
        </div>
      </details>
    </li>
  );
}

export function StockItemList({ items, blocked = false, open = false, label }: { items: StockItem[]; blocked?: boolean; open?: boolean; label: string }) {
  return (
    <div className={cx("overflow-hidden rounded-[16px] border bg-surface", blocked ? "border-[var(--bad-bd)]" : "border-line")}>
      <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_24px] gap-x-3 bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted lg:grid" aria-hidden>
        <span>{label}</span>
        <span>Status</span>
        <span>Quantity</span>
        <span>{blocked ? "Expiry" : "Next expiry"}</span>
        <span />
      </div>
      <ul className="divide-y divide-line" aria-label={label}>
        {items.map((i) => (
          <ItemRow key={`${i.kind}:${i.id}`} item={i} blocked={blocked} open={open} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The ONE total of an item, in the same words as the item page (grade-5 usability test 2026-10-30):
 * "Total 273.91 kg = ready 273.91 kg · waiting for QA check 0 kg · stopped by QA 0 kg · expired 0 kg · bad 0 kg".
 */
function TotalLine({ item }: { item: StockItem }) {
  const b = item.breakdown;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 pt-2.5 text-[13px] text-fg-2 lg:pl-[52px]" data-testid="stock-item-total">
      <span>
        Total <b className="text-fg tabular">{b.totalText}</b> =
      </span>
      <span>ready {b.readyText}</span>
      <span>· waiting for QA check {b.waitingText}</span>
      <span>· stopped by QA {b.onHoldText}</span>
      <span>· expired {b.expiredText}</span>
      <span>· bad {b.badText}</span>
      <Link href={`/inventory/items/${item.kind}/${item.id}`} className="inline-flex min-h-[44px] items-center font-medium text-primary-text underline-offset-2 hover:underline">
        Open {item.name}: suppliers, brands, expiry
      </Link>
    </p>
  );
}

/** "What is a lot?" — said once, in plain words. */
export function WhatIsALot() {
  return (
    <details className="text-[13px]">
      <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-medium text-primary-text">What is a lot?</summary>
      <p className="max-w-prose pb-2 text-fg-2">A lot is one delivery or one batch of a material, with its own expiry date. Each container label shows its lot number.</p>
    </details>
  );
}
