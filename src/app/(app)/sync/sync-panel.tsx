"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { syncAgent } from "@/lib/offline/agent";
import { OfflineRefused } from "@/lib/offline/outbox";
import { queueAgeWarning } from "@/lib/offline/policy";
import { REASON_LABEL, WORKFLOW_LABEL, type SyncConflictReason } from "@/lib/offline/protocol";
import type { OutboxEntry } from "@/lib/offline/store";
import { fmtDateTime } from "@/lib/qty";
import { Button, Card, CardTitle, EmptyState, Field, Input, LinkButton, Select, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { FreshnessBadge, OutboxChip, SyncNowButton, syncLabel, useSync } from "@/ui/sync-status";

type Site = { id: string; code: string; name: string };

/**
 * This device's sync panel (US-7-06; docs/ux-system.md 5.21): connection and last sync, the queue
 * with its device-side statuses and retry state, offline data freshness, and the device registration.
 */
export function SyncPanel({ userId, sites, currentSiteId }: { userId: string; sites: Site[]; currentSiteId: string }) {
  const s = useSync(userId);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (s.ready) void syncAgent().listQueue().then(setQueue);
  }, [s.ready, s.stats, s.lastSyncAt]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That did not work." });
    } finally {
      setBusy(null);
    }
  };

  const label = syncLabel(s);
  const device = s.snapshot?.device ?? null;
  const policy = s.snapshot?.policy;
  const warnings = policy && now ? queue.filter((e) => e.status === "pending" || e.status === "failed").map((e) => ({ e, w: queueAgeWarning(e.createdAt, now, policy.maxQueueAgeHours) })).filter((x) => x.w) : [];

  if (!s.supported) {
    return (
      <Banner tone="warn" title="This browser cannot store offline data">
        Offline work needs a browser with IndexedDB (current Chrome, Safari or Edge). Everything else works while connected.
      </Banner>
    );
  }

  return (
    <div className="space-y-5">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={cx("rounded-[10px] border px-3 py-2 text-[13px]", msg.ok ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]")}>
          {msg.text}
        </p>
      )}
      {s.needsSignIn && (
        <Banner tone="warn" title="Sign in again to sync">
          Your sign-in has expired. Queued changes stay on this device and are sent after you sign in.
        </Banner>
      )}
      {s.permissionsChangedAt && (
        <Banner tone="warn" title="Your permissions changed">
          Since {fmtDateTime(s.permissionsChangedAt)} some queued changes were refused because your access changed. They are listed for review below.
        </Banner>
      )}
      {s.handedOver > 0 && (
        <Banner tone="info" title="Changes from the previous person were sent for review">
          {s.handedOver} unsent change(s) recorded by the person signed in before you were sent to the supervisor&apos;s review queue. Nothing of theirs is shown here.
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="warn" title={warnings.some((x) => x.w!.expired) ? "Some changes are too old to apply automatically" : `Sync within ${Math.min(...warnings.map((x) => x.w!.hoursLeft))} h`}>
          Changes queued longer than {policy!.maxQueueAgeHours} h need a supervisor&apos;s review before they apply.
        </Banner>
      )}

      <Card>
        <CardTitle action={<SyncNowButton siteId={currentSiteId} />}>This device</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={label.tone === "ok" ? "ok" : label.tone === "bad" ? "bad" : label.tone === "warn" ? "warn" : "info"}>
            {label.icon} {label.text}
          </Chip>
          <span className="text-[13px] text-muted">{s.lastSyncAt ? `Last sync ${fmtDateTime(s.lastSyncAt)}` : "Not synced yet"}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="sync-counts">
          {(
            [
              ["Pending", s.stats.pending + s.stats.syncing],
              ["Synced (24 h)", s.stats.synced],
              ["Could not send", s.stats.failed],
              ["Need review", s.stats.conflict],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 font-display text-[22px] font-semibold tabular">{v}</dd>
            </div>
          ))}
        </dl>
        {s.lastError && <p className="mt-3 text-[13px] text-[var(--warn-fg)]">{s.lastError}</p>}
      </Card>

      <Card>
        <CardTitle>Offline data</CardTitle>
        <p className="mb-3 text-[13px] text-muted">
          Materials, locations, lots with their stock, open counts and batches in weighing for one site, kept on this device so you can count and weigh without signal. Prices, costs and personal data are
          never stored. Offline sign-in valid until {s.snapshot ? fmtDateTime(s.snapshot.expiresAt) : "—"}.
        </p>
        <ul className="divide-y divide-line">
          {sites.map((site) => (
            <li key={site.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  {site.code} · {site.name}
                </p>
                <FreshnessBadge at={s.referenceAt[site.id]} staleAfterHours={policy?.fullRefreshAfterHours ?? 24} />
              </div>
              <Button variant="secondary" size="sm" disabled={busy !== null || !s.online} onClick={() => void run(`ref-${site.id}`, () => syncAgent().refreshReference(site.id), `Offline data for ${site.code} saved on this device.`)}>
                {busy === `ref-${site.id}` ? "Downloading…" : s.referenceAt[site.id] ? "Refresh offline data" : "Download offline data"}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <LinkButton href="/offline" variant="primary">
            Open the offline workspace
          </LinkButton>
        </div>
      </Card>

      <DeviceCard sites={sites} currentSiteId={currentSiteId} busy={busy} run={run} online={s.online} device={device} />

      <Card>
        <CardTitle>Queue on this device</CardTitle>
        {queue.length === 0 ? (
          <EmptyState title="Nothing queued">Counts and weighings saved offline appear here until the server confirms them.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="outbox-list">
            {queue.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-medium">{e.summary}</p>
                  <p className="text-[12px] text-muted">
                    Saved {fmtDateTime(e.createdAt)}
                    {e.appliedEntityNumber ? ` · ${e.appliedEntityNumber}` : ""}
                    {e.lastError && e.status !== "synced" ? ` · ${e.lastError}` : ""}
                  </p>
                  {e.reasonCode && <p className="text-[12px] text-[var(--bad-fg)]">{REASON_LABEL[e.reasonCode as SyncConflictReason] ?? e.reasonCode}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OutboxChip entry={e} />
                  {e.conflictId && (
                    <Link href={`/sync/conflicts/${e.conflictId}`} className="text-[13px] font-medium text-primary-text hover:underline">
                      See review
                    </Link>
                  )}
                  {(e.status === "pending" || e.status === "failed") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null || !s.online}
                      onClick={() => {
                        if (window.confirm(`Remove "${e.summary}" from the queue? It will not be sent.`)) void run(`rm-${e.id}`, () => syncAgent().removeFromQueue(e.id), "Removed from the queue.");
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DeviceCard({
  sites,
  currentSiteId,
  busy,
  run,
  online,
  device,
}: {
  sites: Site[];
  currentSiteId: string;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;
  online: boolean;
  device: NonNullable<ReturnType<typeof useSync>["snapshot"]>["device"];
}) {
  const [label, setLabel] = useState("");
  const [deviceClass, setDeviceClass] = useState("floor_shared");
  const [siteId, setSiteId] = useState(currentSiteId);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <CardTitle>Device registration</CardTitle>
      {device && device.status !== "removed" ? (
        <div className="space-y-2 text-[14px]">
          <p>
            <span className="font-medium">{device.label}</span> · site {device.siteCode}{" "}
            <Chip tone={device.status === "active" ? "ok" : device.status === "pending" ? "info" : "warn"}>{device.status === "active" ? "Registered" : device.status === "pending" ? "Waiting for approval" : "Suspended"}</Chip>
          </p>
          {device.status === "active" && (
            <p className="text-[13px] text-muted">
              Offline here: {device.allowedWorkflows.length ? device.allowedWorkflows.map((w) => WORKFLOW_LABEL[w]).join(", ") : "nothing yet (ask your site manager)"}.
            </p>
          )}
          {device.status === "pending" && <p className="text-[13px] text-muted">A device administrator (site manager or system administrator) approves the request in Admin › Devices and chooses what may run offline.</p>}
          {device.status === "suspended" && <p className="text-[13px] text-muted">An administrator suspended this device. Offline work is blocked until it is reactivated.</p>}
        </div>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            setErr(null);
            if (label.trim().length < 3) {
              setErr("Name the device (at least 3 characters), e.g. Weighing tablet 1.");
              return;
            }
            void run("register", () => syncAgent().registerDevice({ label: label.trim(), deviceClass, siteId }).catch((e) => {
              throw e instanceof OfflineRefused || e instanceof Error ? e : new Error("Registration failed.");
            }), "Registration requested. A device administrator will approve it.");
          }}
        >
          <p className="text-[13px] text-muted sm:col-span-3">
            Counting and weighing offline run only on registered devices (unregistered browsers may queue stock moves only). Register this device to a site; a device administrator approves it.
          </p>
          <Field label="Device name" htmlFor="device-label" error={err ?? undefined}>
            <Input id="device-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Weighing tablet 1" maxLength={80} />
          </Field>
          <Field label="Kind of device" htmlFor="device-class">
            <Select id="device-class" value={deviceClass} onChange={(e) => setDeviceClass(e.target.value)}>
              <option value="floor_shared">Shared floor device</option>
              <option value="personal">Personal phone</option>
              <option value="managed_tablet">Managed tablet</option>
            </Select>
          </Field>
          <Field label="Site" htmlFor="device-site">
            <Select id="device-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={busy !== null || !online}>
              {busy === "register" ? "Requesting…" : "Request registration"}
            </Button>
            {!online && <p className="mt-1 text-[12px] text-muted">Needs a connection.</p>}
          </div>
        </form>
      )}
    </Card>
  );
}
