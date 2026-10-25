"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { syncAgent } from "@/lib/offline/agent";
import { canQueueOffline } from "@/lib/offline/policy";
import type { OfflineCommandType, ReferenceBatch, ReferenceCount, ReferenceLocation, ReferenceLot, ReferenceMaterial } from "@/lib/offline/protocol";
import type { OutboxEntry } from "@/lib/offline/store";
import { fmtDateTime } from "@/lib/qty";
import { Logo } from "@/ui/brand";
import { Card, CardTitle, EmptyState, Field, LinkButton, Select, cx } from "@/ui/core";
import { Banner } from "@/ui/status";
import { FreshnessBadge, OutboxChip, SyncNowButton, syncLabel, useSync } from "@/ui/sync-status";
import { CountCapture } from "./count-capture";
import { WeighCapture } from "./weigh-capture";

export type Ref = { materials: ReferenceMaterial[]; locations: ReferenceLocation[]; lots: ReferenceLot[]; counts: ReferenceCount[]; batches: ReferenceBatch[] };
const EMPTY: Ref = { materials: [], locations: [], lots: [], counts: [], batches: [] };

type Tab = "count" | "weigh" | "queue";

/**
 * Counting and weighing without signal (US-7-04). Only the approved offline workflows appear;
 * each shows why it is unavailable ("Needs a connection: …") instead of disappearing. Captures go
 * to the device outbox and sync when the connection is back.
 */
export function OfflineWorkspace() {
  const s = useSync();
  const [ref, setRef] = useState<Ref>(EMPTY);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("count");
  const [now, setNow] = useState<Date | null>(null);

  const reload = useCallback(async () => {
    setRef(await syncAgent().reference());
    setQueue(await syncAgent().listQueue());
  }, []);

  useEffect(() => {
    setNow(new Date());
    if (s.ready) void reload();
  }, [s.ready, s.stats, s.referenceAt, reload]);

  const snap = s.snapshot;
  useEffect(() => {
    if (snap && !siteId) setSiteId(snap.device?.status === "active" ? snap.device.siteId : snap.currentSiteId);
  }, [snap, siteId]);

  const site = snap?.sites.find((x) => x.id === siteId) ?? null;
  const decide = (type: OfflineCommandType) => (snap && siteId && now ? canQueueOffline(snap, type, siteId, now) : null);
  const countDecision = decide("inventory.stock_count.record");
  const weighDecision = decide("production.dispense_record.create");
  const siteRef = useMemo(
    () => ({
      materials: ref.materials,
      locations: ref.locations.filter((l) => l.siteId === siteId),
      lots: ref.lots.filter((l) => l.siteId === siteId),
      counts: ref.counts.filter((c) => c.siteId === siteId),
      batches: ref.batches.filter((b) => b.siteId === siteId),
    }),
    [ref, siteId],
  );
  const label = syncLabel(s);

  return (
    <div className="min-h-dvh bg-bg pb-10">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-[64px] max-w-[960px] items-center gap-3 px-4">
          <Logo className="h-8 w-auto shrink-0" />
          <span className="hidden font-display text-[15px] font-semibold sm:inline">Offline workspace</span>
          <span className={cx("ml-auto flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[12.5px] font-medium shadow-[var(--shadow-card)]", label.tone === "bad" ? "text-[var(--bad-fg)]" : label.tone === "warn" ? "text-[var(--warn-fg)]" : "text-fg-2")} data-testid="offline-status">
            {label.icon}
            {label.text}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[960px] space-y-4 px-4 py-5">
        {!s.ready ? (
          <p className="text-[13px] text-muted" role="status">
            Opening this device&apos;s offline data…
          </p>
        ) : !s.supported ? (
          <Banner tone="warn" title="This browser cannot store offline data">Use a current Chrome, Safari or Edge.</Banner>
        ) : !snap ? (
          <Card>
            <EmptyState title="No offline data on this device" action={<LinkButton href="/sync">Open Sync (needs a connection)</LinkButton>}>
              Connect to the network, sign in and open Sync once: register the device and download the offline data for your site. Then counting and weighing work here without signal.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px]">
                Signed in as <span className="font-medium">{snap.displayName}</span>
              </p>
              {snap.sites.length > 1 && (
                <Field label="Site" htmlFor="offline-site">
                  <Select id="offline-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                    {snap.sites.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <FreshnessBadge at={s.referenceAt[siteId]} staleAfterHours={snap.policy.fullRefreshAfterHours} />
              <span className="ml-auto">{s.online && <SyncNowButton siteId={siteId} />}</span>
            </div>
            {now && new Date(snap.expiresAt) < now && (
              <Banner tone="warn" title="Offline sign-in expired">
                This device last reached the server {fmtDateTime(snap.issuedAt)}. New offline work is blocked until you connect; queued work is kept.
              </Banner>
            )}
            {s.needsSignIn && <Banner tone="warn" title="Sign in again to sync">Your queued changes stay on this device until you sign in.</Banner>}
            {!s.referenceAt[siteId] && <Banner tone="info" title={`No offline data for ${site?.code ?? "this site"} yet`}>Open Sync while connected and download the offline data for this site.</Banner>}

            <nav aria-label="Offline tasks" className="flex flex-wrap gap-2">
              {(
                [
                  ["count", "Count"],
                  ["weigh", "Weighing"],
                  ["queue", `Queue · ${s.stats.pending + s.stats.syncing + s.stats.failed + s.stats.conflict}`],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className={cx("min-h-[44px] rounded-full border px-4 text-[14px]", tab === k ? "border-transparent bg-cta font-medium text-white" : "border-line bg-surface")}>
                  {l}
                </button>
              ))}
            </nav>

            {tab === "count" &&
              (countDecision && !countDecision.ok ? (
                <Banner tone="warn" title="Counting is not available offline here">{countDecision.message}</Banner>
              ) : (
                <CountCapture siteId={siteId} data={siteRef} queue={queue} onQueued={reload} />
              ))}
            {tab === "weigh" &&
              (weighDecision && !weighDecision.ok ? (
                <Banner tone="warn" title="Weighing is not available offline here">{weighDecision.message}</Banner>
              ) : (
                <WeighCapture siteId={siteId} data={siteRef} queue={queue} onQueued={reload} />
              ))}
            {tab === "queue" && (
              <Card>
                <CardTitle>Queued on this device</CardTitle>
                {queue.length === 0 ? (
                  <EmptyState title="Nothing queued" />
                ) : (
                  <ul className="divide-y divide-line" data-testid="offline-queue">
                    {queue.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="break-words text-[14px]">{e.summary}</p>
                          <p className="text-[12px] text-muted">
                            {fmtDateTime(e.createdAt)}
                            {e.lastError && e.status !== "synced" ? ` · ${e.lastError}` : ""}
                          </p>
                        </div>
                        <OutboxChip entry={e} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            <p className="text-[12px] text-muted">
              Everything else needs a connection: QA release, holds, approvals, posting and dispatch are online-only. <Link href="/dashboard" className="text-primary-text underline">Back to the app</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
