"use client";
import { useCallback, useRef, useState, useTransition } from "react";
import type { ScanCard } from "@/modules/scan";
import { Card } from "@/ui/core";
import { Scanner } from "@/ui/scanner";
import { ScanResultCard } from "@/ui/scanner-result-card";
import { scanCardAction } from "./actions";

type Recent = { payload: string; summary: string; at: string };

export function ScanClient() {
  const [card, setCard] = useState<ScanCard | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [pending, start] = useTransition();
  const [offline, setOffline] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const onScan = useCallback((value: string) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOffline(true);
      return;
    }
    setOffline(false);
    start(async () => {
      const c = await scanCardAction(value);
      setCard(c);
      const summary = c.outcome === "found" ? `${c.caption} ${c.identifier}` : c.message;
      setRecent((r) => [{ payload: c.payload || value, summary, at: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }, ...r].slice(0, 8));
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <Scanner onScan={onScan} pending={pending} placeholder="Scan a label, or type a lot number or a material name (e.g. coconut)" />
        {offline && (
          <p role="alert" className="mt-3 rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">
            You&apos;re offline. Look-ups need a connection; scan again when you&apos;re back online.
          </p>
        )}
      </Card>

      <div ref={resultRef} aria-busy={pending}>
        {pending && !card && <div className="h-40 animate-pulse rounded-[24px] bg-surface-2" aria-label="Looking up" />}
        {card && (
          <div className={pending ? "opacity-60" : undefined}>
            <ScanResultCard
              card={card}
              onScanAgain={() => {
                setCard(null);
                document.getElementById("scan-input")?.focus();
              }}
            />
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <Card>
          <h2 className="mb-2 text-[15px] font-semibold">Recent scans</h2>
          <ul className="divide-y divide-line text-[13px]">
            {recent.map((r, i) => (
              <li key={`${r.payload}-${i}`} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block break-all font-mono">{r.payload}</span>
                  <span className="text-muted">{r.summary}</span>
                </span>
                <span className="shrink-0 text-muted tabular">{r.at}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <details>
          <summary className="cursor-pointer text-[15px] font-semibold">What can I scan?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-fg-2">
            <li>Lot labels <code>BC:LOT:…</code> or a typed lot number such as <code>L-2610-00001</code></li>
            <li>Location <code>BC:LOC:…</code>, material <code>BC:MAT:…</code> and SKU <code>BC:SKU:…</code> labels</li>
            <li>Document codes <code>BC:DOC:…</code> printed on documents (opens the record after sign-in)</li>
            <li>Typed batch (<code>B-26-…</code>), order (<code>SO-26-…</code>), delivery receipt (<code>DR-26-…</code>) and receipt (<code>GR-26-…</code>) numbers</li>
            <li>Box <code>BC:BOX:…</code> and equipment <code>BC:EQP:…</code> labels are recognised; their records arrive in a later release</li>
          </ul>
          <p className="mt-2 text-[12px] text-muted">Only records in your sites are found. Web links are never opened from a scan.</p>
        </details>
      </Card>
    </div>
  );
}
