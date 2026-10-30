import Link from "next/link";
import { AlertTriangle, Lock, SearchX, Tag } from "lucide-react";
import type { ScanCard } from "@/modules/scan";
import { Card, buttonClass, cx } from "./core";
import { Banner, Chip, StatusChip } from "./status";

/**
 * Scan result card (ux-system §5.9): identity, status, risk banner, holdings, label state and
 * the server's allowed actions. Disallowed actions are listed greyed with a lock and the reason,
 * never clickable. Pure presentation of the server's ScanCard.
 */
export function ScanResultCard({ card, onScanAgain }: { card: ScanCard; onScanAgain?: () => void }) {
  if (card.outcome !== "found") {
    const tone = card.outcome === "not_recognised" || card.outcome === "rate_limited" ? "warn" : card.outcome === "not_supported" ? "info" : "neu";
    return (
      <Card data-testid="scan-result" data-outcome={card.outcome} aria-live="polite">
        <div className="flex items-start gap-3">
          <SearchX size={24} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">{card.matches?.length ? "Did you mean…" : card.outcome === "not_recognised" ? "Not recognised" : card.outcome === "not_found" ? "Not found" : card.outcome === "rate_limited" ? "Slow down" : card.outcome === "forbidden" ? "No access" : "Recognised"}</p>
            <p className="mt-0.5 text-[14px] text-fg-2">{card.message}</p>
            {card.payload && !card.matches?.length && <p className="mt-1 break-all font-mono text-[12px] text-muted"><Chip tone={tone}>Scanned</Chip> {card.payload}</p>}
          </div>
        </div>
        {/* ADR-085: typed words list the lots that match; tap one to open it. */}
        {card.matches && card.matches.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line" data-testid="scan-matches">
            {card.matches.map((m) => (
              <li key={m.href}>
                <Link href={m.href} className="flex min-h-[56px] flex-col justify-center gap-0.5 px-3.5 py-2.5 hover:bg-surface-2">
                  <span className="text-[15px] font-medium text-fg">{m.title}</span>
                  <span className="text-[13px] text-fg-2">{m.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {onScanAgain && (
          <div className="mt-4">
            <button type="button" onClick={onScanAgain} className={buttonClass("secondary")}>Scan again</button>
          </div>
        )}
      </Card>
    );
  }

  const allowed = card.actions.filter((a) => a.allowed && a.href);
  const blocked = card.actions.filter((a) => !a.allowed);
  return (
    <Card data-testid="scan-result" data-outcome="found" data-entity={card.entity} aria-live="polite" className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{card.caption}{card.siteCode ? ` · ${card.siteCode}` : ""}</p>
        <p className="mt-1 break-all font-mono text-[24px] font-semibold leading-tight text-fg">{card.identifier}</p>
        <p className="mt-1 text-[15px] text-fg">{card.title}</p>
        {card.subtitle && <p className="text-[13px] text-muted">{card.subtitle}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {card.status && <StatusChip status={card.status.code} label={card.status.label} />}
          {card.expiry && (
            <Chip tone={card.expiry.daysLeft !== null && card.expiry.daysLeft < 0 ? "exp" : card.expiry.daysLeft !== null && card.expiry.daysLeft <= 30 ? "warn" : "neu"}>
              Expiry {card.expiry.date}
              {card.expiry.daysLeft !== null && (card.expiry.daysLeft < 0 ? ` · expired ${-card.expiry.daysLeft} d ago` : ` · ${card.expiry.daysLeft} d left`)}
            </Chip>
          )}
        </div>
      </div>

      {card.risk && (
        <Banner tone={card.risk.tone} title={card.risk.title}>
          {card.risk.body}
        </Banner>
      )}
      {card.labels?.mismatch && (
        <Banner tone="warn" title="Label out of date">
          {card.labels.mismatch}
        </Banner>
      )}

      {card.facts.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {card.facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="break-words text-[14px] tabular">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.holdings && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{card.entity === "location" ? "Holds" : "Locations"}</p>
          {card.holdings.length === 0 ? (
            <p className="text-[13px] text-muted">{card.entity === "location" ? "Nothing stored here right now." : "No stock on hand."}</p>
          ) : (
            <ul className="divide-y divide-line rounded-[12px] border border-line">
              {card.holdings.map((h) => (
                <li key={h.label} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 break-words">{h.href ? <Link href={h.href} className="text-primary-text hover:underline">{h.label}</Link> : h.label}</span>
                  <span className="shrink-0 font-medium tabular">{h.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {card.labels && (
        <div className="text-[13px] text-fg-2">
          <p className="flex items-center gap-1.5"><Tag size={14} aria-hidden="true" /> Labels printed: {card.labels.printed} · reprints: {card.labels.reprints}</p>
          {card.labels.superseded.length > 0 && (
            <div className="mt-2 rounded-[12px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[var(--bad-fg)]" data-testid="superseded-labels">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} aria-hidden="true" /> Superseded label — destroy</p>
              <ul className="mt-1 list-disc pl-5">
                {card.labels.superseded.map((s) => (
                  <li key={s.ref}><span className="font-mono">{s.ref}</span>{s.printedAt ? ` (printed ${s.printedAt})` : ""}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {allowed.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {allowed.map((a) => (
              <Link key={a.key} href={a.href!} className={cx(buttonClass(a.primary ? "cta" : "secondary", "lg"), "w-full sm:w-auto")} data-action={a.key}>
                {a.label}
              </Link>
            ))}
          </div>
        )}
        {blocked.map((a) => (
          <div key={a.key} className="flex min-h-[44px] items-start gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[13px] text-muted" aria-disabled="true" data-blocked={a.key}>
            <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span><span className="font-medium">{a.label}</span>: {a.reason}</span>
          </div>
        ))}
      </div>

      {onScanAgain && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <button type="button" onClick={onScanAgain} className={buttonClass("secondary")}>Scan again</button>
          <p className="text-[12px] text-muted">Not what you expected? Tell your supervisor the label may be wrong.</p>
        </div>
      )}
    </Card>
  );
}
