import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import type { ExpiryBucket, ItemLot, ItemMovement, PlaceRow, SupplierRow } from "@/modules/inventory/item-stock";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { Card, cx } from "@/ui/core";
import { ItemStateChip } from "./stock-items";

/**
 * Item page pieces (owner question 2026-10-30). Pure presentation of the server read model `getItemStock`;
 * grade-5 words, mobile first (cards and lists, no wide tables), every row a 44 px+ tap target.
 */

export function daysWords(days: number | null): string {
  if (days === null) return "no expiry date";
  if (days < 0) return `expired ${-days} ${-days === 1 ? "day" : "days"} ago`;
  if (days === 0) return "expires today";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

function daysTone(days: number | null): string {
  if (days === null) return "text-muted";
  if (days < 0) return "text-[var(--bad-fg)] font-semibold";
  if (days <= 30) return "text-[var(--warn-fg)] font-semibold";
  return "text-fg-2";
}

export function ExpiryLine({ date, days }: { date: string | null; days: number | null }) {
  if (!date) return <span className="text-muted">No expiry date</span>;
  return (
    <span className="whitespace-nowrap">
      {fmtDate(date)} <span className={cx("text-[12px]", daysTone(days))}>· {daysWords(days)}</span>
    </span>
  );
}

const TONE: Record<"ok" | "q" | "hold" | "bad" | "warn" | "neu", string> = {
  ok: "border-[var(--ok-bd)] bg-[var(--ok-bg)]",
  q: "border-[var(--q-bd)] bg-[var(--q-bg)]",
  hold: "border-[var(--hold-bd)] bg-[var(--hold-bg)]",
  bad: "border-[var(--bad-bd)] bg-[var(--bad-bg)]",
  warn: "border-[var(--warn-bd)] bg-[var(--warn-bg)]",
  neu: "border-line bg-surface",
};

/** One big number. */
export function BigNumber({ label, value, hint, tone = "neu", testId }: { label: string; value: string; hint?: ReactNode; tone?: keyof typeof TONE; testId?: string }) {
  return (
    <div className={cx("flex min-h-[112px] flex-col rounded-[20px] border p-4", TONE[tone])} data-testid={testId}>
      <p className="text-[13px] font-semibold text-fg-2">{label}</p>
      <p className="mt-1.5 font-display text-[28px] font-semibold leading-tight text-fg tabular sm:text-[32px]">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-fg-2">{hint}</p>}
    </div>
  );
}

export function Section({ id, title, hint, children, action }: { id: string; title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card aria-labelledby={`${id}-h`} data-testid={`item-${id}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-h`} className="font-display text-[18px] font-semibold text-fg">{title}</h2>
          {hint && <p className="text-[13px] text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-4 text-center text-[14px] text-muted">{children}</p>;
}

/** "Who we bought it from" (materials) or "Which batch made it" (products). */
export function SupplierList({ rows, kind }: { rows: SupplierRow[]; kind: "material" | "product" }) {
  return (
    <ul className="divide-y divide-line rounded-[16px] border border-line">
      {rows.map((s, i) => {
        const title = kind === "material" ? (s.supplierName ?? "Supplier not written down") : s.batchNumber ? `Batch ${s.batchNumber}` : "No batch number (older stock)";
        const sub = kind === "material" ? (s.brand ? `Brand: ${s.brand}` : "Brand not written down") : s.madeOn ? `Made on ${fmtDate(s.madeOn)}` : "Date not written down";
        const parts = [
          s.ready.qty !== "0" ? `${s.ready.text} ready to use` : null,
          s.waiting.qty !== "0" ? `${s.waiting.text} waiting for check` : null,
          s.onHold.qty !== "0" ? `${s.onHold.text} on hold` : null,
          s.doNotUse.qty !== "0" ? `${s.doNotUse.text} do not use` : null,
        ].filter(Boolean);
        const onlyReady = parts.length === 1 && s.ready.qty === s.total.qty;
        return (
          <li key={i} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center" data-testid="item-supplier-row">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-fg">{title}</span>
              <span className="block text-[13px] text-fg-2">{sub} · {s.lots} {s.lots === 1 ? "lot" : "lots"}</span>
            </span>
            <span className="text-[13px]">
              <span className="block text-[16px] font-semibold tabular text-fg">{s.total.text}</span>
              <span className="block text-fg-2">{onlyReady ? "All ready to use" : parts.join(" · ")}</span>
            </span>
            <span className="text-[13px]">
              <span className="text-muted">Expires first: </span>
              <ExpiryLine date={s.nearestExpiry} days={s.nearestDaysLeft} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function lotTitle(l: { supplierName: string | null; brand: string | null; batchNumber: string | null }, kind: "material" | "product") {
  if (kind === "product") return l.batchNumber ? `Batch ${l.batchNumber}` : "No batch number (older stock)";
  return [l.supplierName ?? "Supplier not written down", l.brand].filter(Boolean).join(" · ");
}

export function ExpiringList({ buckets, kind }: { buckets: ExpiryBucket[]; kind: "material" | "product" }) {
  const shown = buckets.filter((b) => b.lots.length > 0);
  return (
    <div className="space-y-4">
      {shown.map((b) => (
        <div key={b.key} data-testid={`item-expiry-${b.key}`}>
          <h3 className={cx("mb-1.5 text-[14px] font-semibold", b.key === "expired" ? "text-[var(--bad-fg)]" : b.key === "d30" ? "text-[var(--warn-fg)]" : "text-fg")}>
            {b.label} · {b.total.text}
            {b.key === "expired" && <span className="font-normal text-fg-2"> (do not use)</span>}
          </h3>
          <ul className="divide-y divide-line rounded-[16px] border border-line">
            {b.lots.map((l) => (
              <li key={l.lotId}>
                <Link href={`/inventory/${l.lotId}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-fg">{lotTitle(l, kind)}</span>
                    <span className="block text-[12px] text-fg-2">
                      <ExpiryLine date={l.expiresOn} days={l.daysLeft} /> · <span className="whitespace-nowrap">Lot {l.lotNumber}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[15px] font-semibold tabular">{l.qtyText}</span>
                  <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function PlacesList({ places, showSite }: { places: PlaceRow[]; showSite: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {places.map((p) => (
        <div key={p.section} className="rounded-[16px] border border-line" data-testid="item-place">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-[14px]">
            <span className="font-semibold">{p.sectionLabel}</span>
            <span className="font-semibold tabular">{p.total.text}</span>
          </div>
          <ul className="divide-y divide-line">
            {p.locations.map((l) => (
              <li key={l.locationId}>
                <Link href={`/inventory/locations/${l.locationId}`} className="flex min-h-[48px] items-center gap-3 px-4 py-2 text-[14px] hover:bg-surface-2">
                  <MapPin size={15} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-fg">{l.name}</span>
                    <span className="block text-[12px] text-muted">
                      {l.name !== l.code ? `${l.code} · ` : ""}
                      {l.lots} {l.lots === 1 ? "lot" : "lots"}
                      {showSite ? ` · ${l.siteCode}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular">{l.qtyText}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function LotList({ lots, kind, showSite, offset = 0 }: { lots: ItemLot[]; kind: "material" | "product"; showSite: boolean; offset?: number }) {
  return (
    <ol start={offset + 1} className="divide-y divide-line rounded-[16px] border border-line" data-testid="item-lots">
      {lots.map((l, i) => {
        const blocked = l.state === "expired" || l.state === "rejected" || l.state === "recalled";
        return (
          <li key={l.lotId} className={cx(blocked && "bg-[var(--bad-bg)]/40")}>
            <Link href={`/inventory/${l.lotId}`} className="grid min-h-[56px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 lg:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_auto] lg:items-center">
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-surface-2 text-[12px] font-semibold tabular text-fg-2" aria-label={`Number ${offset + i + 1} in the order to use`}>
                {offset + i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-fg">{lotTitle(l, kind)}</span>
                <span className="block text-[12px] text-fg-2">
                  {kind === "material" ? "Received" : "Made"} {fmtDate(l.dateOn)} · <span className="whitespace-nowrap">Lot {l.lotNumber}</span>
                  {l.supplierLotNumber ? <> · <span className="whitespace-nowrap">their lot {l.supplierLotNumber}</span></> : ""}
                  {showSite ? ` · ${l.siteCode}` : ""}
                </span>
              </span>
              <span className="row-span-1 text-right lg:order-last lg:text-right">
                <span className="block text-[15px] font-semibold tabular">{l.qtyText}</span>
                {l.setAside !== "0" && <span className="block text-[11px] text-fg-2">some set aside</span>}
              </span>
              <span className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] lg:col-span-1 lg:col-start-auto">
                <ItemStateChip state={l.state} />
                <ExpiryLine date={l.expiresOn} days={l.daysLeft} />
              </span>
              <span className="col-span-2 col-start-2 text-[12px] text-fg-2 lg:col-span-1 lg:col-start-auto">
                <MapPin size={12} className="mr-1 inline text-muted" aria-hidden />
                {l.where}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function MovementList({ movements, showLink }: { movements: ItemMovement[]; showLink: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-[16px] border border-line" data-testid="item-movements">
      {movements.map((m) => (
        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5">
          <span className="min-w-0 text-[14px] text-fg">
            {m.sentence}
            <span className="block text-[12px] text-muted">
              Lot{" "}
              <Link href={`/inventory/${m.lotId}`} className="text-primary-text underline-offset-2 hover:underline">
                {m.lotNumber}
              </Link>
              {m.by ? ` · by ${m.by}` : ""}
            </span>
          </span>
          <span className="text-[12px] whitespace-nowrap text-muted">{fmtDateTime(m.postedAt)}</span>
        </li>
      ))}
      {showLink && <li className="px-4 py-2 text-[12px] text-muted">Only the last 10 are shown. Open a lot to see all of its history.</li>}
    </ul>
  );
}

/** A long list shows the first `first` rows; the rest open with "Show N more" (native details, no JavaScript). */
export function ShowMore<T>({ items, first, render, noun }: { items: T[]; first: number; render: (rows: T[], offset: number) => ReactNode; noun: string }) {
  if (items.length <= first + 2) return <>{render(items, 0)}</>;
  const rest = items.length - first;
  return (
    <div className="space-y-2">
      {render(items.slice(0, first), 0)}
      <details className="group">
        <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center rounded-full border border-line px-4 text-[14px] font-medium text-primary-text hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show {rest} more {noun}</span>
          <span className="hidden group-open:inline">Show fewer</span>
        </summary>
        <div className="mt-2">{render(items.slice(first), first)}</div>
      </details>
    </div>
  );
}
