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
      const summary = c.outcome === "found" ? `${c.title} · ${c.caption} ${c.identifier}` : c.message;
      // Words show as typed; the time is Manila time like the rest of the app (usability test 2026-10-30).
      setRecent((r) => [{ payload: c.outcome === "found" ? c.payload || value : value, summary, at: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" }) }, ...r].slice(0, 8));
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <Scanner onScan={onScan} pending={pending} label="Scan the label, or type what it is" placeholder="e.g. coconut oil" keepCase />
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
          <h2 className="mb-2 text-[15px] font-semibold">Recent look-ups</h2>
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
          <summary className="min-h-[44px] cursor-pointer py-2 text-[15px] font-semibold">Where is the label?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-fg-2">
            <li>Sacks, drums and pails: the white lot label on the side, with a square barcode.</li>
            <li>Boxes and cartons: the box label on the short side (it says &quot;Box&quot; and &quot;n of N&quot;).</li>
            <li>Shelves: the shelf label on the front edge of the shelf.</li>
            <li>Papers (batch sheet, delivery receipt): the square barcode at the top right.</li>
            <li>No label, or it will not scan? Type what it is: a material or product name (&quot;coconut oil&quot;), a customer or supplier name. Every word must match; capitals do not matter.</li>
          </ul>
          <p className="mt-2 text-[12px] text-muted">Only records at your sites and screens your role may open are shown. Web links are never opened from a scan.</p>
        </details>
      </Card>
    </div>
  );
}
