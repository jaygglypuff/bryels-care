"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Cloud, CloudOff, CloudUpload, GitMerge, LogOut, RefreshCw } from "lucide-react";
import { SERVER_STATE, type SyncState, syncAgent } from "@/lib/offline/agent";
import type { OutboxEntry } from "@/lib/offline/store";
import { fmtDateTime } from "@/lib/qty";
import { Button, cx } from "./core";
import { Chip } from "./status";

/**
 * Sync status components (docs/ux-system.md 5.21, docs/offline-sync.md §8): the chip in the top bar,
 * the freshness badge for cached data, the "Pending sync" chip of a queued row, and the sign-out
 * button that warns about unsent changes and clears the device (US-7-06).
 */
export function useSync(expectedUserId: string | null = null): SyncState {
  const state = useSyncExternalStore(syncAgent().subscribe, syncAgent().getState, () => SERVER_STATE);
  useEffect(() => {
    void syncAgent().start(expectedUserId);
  }, [expectedUserId]);
  return state;
}

export function syncLabel(s: SyncState): { text: string; tone: "ok" | "info" | "warn" | "bad"; icon: React.ReactNode } {
  const pending = s.stats.pending + s.stats.syncing;
  if (!s.supported) return { text: "Offline not supported", tone: "warn", icon: <CloudOff size={16} /> };
  if (s.stats.conflict) return { text: `Conflicts ${s.stats.conflict}`, tone: "bad", icon: <GitMerge size={16} /> };
  if (s.stats.failed) return { text: `Failed ${s.stats.failed}`, tone: "bad", icon: <CloudOff size={16} /> };
  if (s.needsSignIn && pending) return { text: `Sign in to sync · ${pending}`, tone: "warn", icon: <CloudOff size={16} /> };
  if (!s.online) return { text: pending ? `Offline · ${pending} pending` : "Offline", tone: "warn", icon: <CloudOff size={16} /> };
  if (s.syncing && pending) return { text: `Syncing · ${pending}`, tone: "info", icon: <CloudUpload size={16} /> };
  if (pending) return { text: `${pending} pending`, tone: "info", icon: <CloudUpload size={16} /> };
  return { text: "Synced", tone: "ok", icon: <Cloud size={16} /> };
}

const TONE: Record<string, string> = {
  ok: "text-fg-2",
  info: "text-[var(--info-fg)] bg-[var(--info-bg)]",
  warn: "text-[var(--warn-fg)] bg-[var(--warn-bg)]",
  bad: "text-[var(--bad-fg)] bg-[var(--bad-bg)]",
};

/** Top-bar chip: Synced / Syncing / Offline · n pending / Failed n / Conflicts n; opens the sync page. */
export function SyncChip({ userId }: { userId: string }) {
  const s = useSync(userId);
  const l = syncLabel(s);
  const quiet = l.tone === "ok";
  // Phones show the icon and a number only, so the top bar never scrolls sideways at 360 px.
  const n = s.stats.conflict || s.stats.failed || s.stats.pending + s.stats.syncing;
  return (
    <Link
      href="/sync"
      className={cx("flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full bg-surface px-2.5 text-[12.5px] font-medium shadow-[var(--shadow-card)] hover:text-fg sm:px-3", TONE[l.tone])}
      aria-label={`Sync status: ${l.text}. Open sync`}
      title={s.lastSyncAt ? `Last sync ${fmtDateTime(s.lastSyncAt)}` : "Sync status"}
      data-testid="sync-chip"
    >
      {l.icon}
      {!quiet && n > 0 && <span className="sm:hidden">{n}</span>}
      <span className={cx("hidden", quiet ? "lg:inline" : "sm:inline")}>{l.text}</span>
    </Link>
  );
}

/** "Data as of <time>" for cached data; warns when older than the full-refresh window (A-OFF-01). */
export function FreshnessBadge({ at, staleAfterHours = 24, label = "Data as of" }: { at: string | null | undefined; staleAfterHours?: number; label?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!at) return <Chip tone="warn">No offline data yet</Chip>;
  const stale = now !== null && now - new Date(at).getTime() > staleAfterHours * 3_600_000;
  return (
    <span data-testid="freshness-badge">
      <Chip tone={stale ? "warn" : "info"}>
        {label} {fmtDateTime(at)}
        {stale ? " · may be outdated" : ""}
      </Chip>
    </span>
  );
}

const ENTRY_CHIP: Record<OutboxEntry["status"], { tone: "info" | "ok" | "bad" | "warn"; label: string }> = {
  pending: { tone: "info", label: "Pending sync" },
  syncing: { tone: "info", label: "Syncing" },
  synced: { tone: "ok", label: "Synced" },
  failed: { tone: "bad", label: "Could not reach the server" },
  conflict: { tone: "bad", label: "Needs review" },
};

export function OutboxChip({ entry }: { entry: Pick<OutboxEntry, "status" | "attempts"> }) {
  const c = ENTRY_CHIP[entry.status];
  return <Chip tone={c.tone}>{entry.status === "failed" ? `${c.label} · ${entry.attempts} attempts` : c.label}</Chip>;
}

/**
 * Sign-out with the logout warning (A-OFF-06, `offline.logout_clears_cache`): unsent changes are
 * listed first; the person may download a support bundle, then discard them (audited
 * `platform.sync_command.discarded`) and sign out. The device store is deleted before the server
 * session ends, so the next person on a shared device sees nothing.
 */
export function SignOutButton({ signOut, variant }: { signOut: () => Promise<void>; variant: "menu" | "rail" }) {
  const [unsent, setUnsent] = useState<OutboxEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed(discard: OutboxEntry[]) {
    setBusy(true);
    setError(null);
    try {
      await syncAgent().clearForSignOut(discard);
    } catch {
      setBusy(false);
      setError("Could not record the discarded changes. Connect to the network and try again; nothing was removed.");
      return;
    }
    await signOut();
  }

  async function start() {
    setError(null);
    let list: OutboxEntry[] = [];
    try {
      await syncAgent().start();
      if (navigator.onLine) await syncAgent().flushNow();
      list = await syncAgent().unsent();
    } catch {
      list = [];
    }
    if (list.length) setUnsent(list);
    else await proceed([]);
  }

  async function bundle() {
    const blob = await syncAgent().supportBundle();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bryels-care-unsent-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {variant === "menu" ? (
        <button type="button" onClick={() => void start()} disabled={busy} className="flex items-center gap-1.5 text-[13px] font-medium text-primary-text hover:underline">
          <LogOut size={14} /> {busy ? "Signing out…" : "Sign out"}
        </button>
      ) : (
        <button type="button" onClick={() => void start()} disabled={busy} className="mt-2 grid size-11 place-items-center rounded-full bg-surface text-fg-2 shadow-[var(--shadow-card)] hover:text-fg" title="Sign out" aria-label="Sign out">
          <LogOut size={18} />
        </button>
      )}
      {unsent && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="unsent-title">
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[20px] bg-surface p-5 shadow-[var(--shadow-pop)]">
            <h2 id="unsent-title" className="font-display text-[18px] font-semibold text-fg">
              {unsent.length} change{unsent.length === 1 ? "" : "s"} not sent yet
            </h2>
            <p className="mt-1 text-[13px] text-muted">Signing out deletes this device&apos;s offline data. These changes have not reached the server and will be lost. Connect and sync first if you can.</p>
            <ul className="mt-3 divide-y divide-line rounded-[12px] border border-line" data-testid="unsent-list">
              {unsent.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 break-words">{e.summary}</span>
                  <OutboxChip entry={e} />
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="mt-3 rounded-[10px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[var(--bad-fg)]">
                {error}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setUnsent(null)} disabled={busy}>
                Keep and stay signed in
              </Button>
              <Button variant="secondary" onClick={() => void bundle()} disabled={busy}>
                Download support file
              </Button>
              <Button variant="danger" onClick={() => void proceed(unsent)} disabled={busy}>
                {busy ? "Signing out…" : "Discard and sign out"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Small "Sync now" button for panels. */
export function SyncNowButton({ siteId }: { siteId?: string }) {
  const s = useSync();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        setBusy(true);
        try {
          await syncAgent().syncNow(siteId);
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy || s.syncing}
    >
      <RefreshCw size={16} className={cx((busy || s.syncing) && "animate-spin")} /> {busy || s.syncing ? "Syncing…" : "Sync now"}
    </Button>
  );
}
