"use client";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { syncAgent } from "@/lib/offline/agent";
import { printPackHtml } from "@/lib/offline/paper-packs";
import type { CachedPaperPack } from "@/lib/offline/store";
import { Card, CardTitle, EmptyState, buttonClass } from "@/ui/core";

/**
 * ADR-134: the paper batch records saved on this device, printable with no internet (the offline workspace). Only the
 * signed-in person's copies are shown; sign-out deletes them.
 */
export function PaperRecords({ userId, siteId }: { userId: string; siteId: string }) {
  const [packs, setPacks] = useState<CachedPaperPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    syncAgent()
      .paperPacks(userId)
      .then(setPacks)
      .catch(() => setError("This device's saved paper records could not be opened."));
  }, [userId]);
  const mine = (packs ?? []).filter((p) => !siteId || p.siteId === siteId);
  return (
    <Card>
      <CardTitle>Paper batch records on this device</CardTitle>
      <p className="mb-3 text-[14px] text-fg-2">Print the record, write on it with a pen while the internet is down, and type it in later: open the batch, then Enter from the paper record.</p>
      {error ? (
        <p role="alert" className="text-[14px] text-[var(--bad-fg)]">
          {error}
        </p>
      ) : packs === null ? (
        <p role="status" className="text-[14px] text-muted">
          Opening…
        </p>
      ) : mine.length === 0 ? (
        <EmptyState title="No paper records saved on this device">
          While the internet works, open My jobs or a batch whose paper record is ready. The records of today&apos;s and the next batches are then saved here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line" data-testid="offline-paper-records">
          {mine.map((p) => (
            <li key={p.batchId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="break-words text-[15px] font-medium">{p.productName}</p>
                <p className="text-[13px] text-muted">
                  Batch {p.batchNumber} · {p.pages.length} pages · made {p.madeAtText}
                </p>
              </div>
              <button type="button" className={buttonClass("cta", "lg") + " min-h-[44px]"} onClick={() => void printPackHtml(p.html)} data-testid={`print-${p.batchNumber}`}>
                <Printer size={18} aria-hidden /> Print the paper record
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
