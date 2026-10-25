import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listDevices } from "@/lib/offline/server/devices";
import { BUILT_OFFLINE_WORKFLOWS, WORKFLOW_LABEL } from "@/lib/offline/protocol";
import { fmtDateTime } from "@/lib/qty";
import { Card, EmptyState, PageHeader, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DeviceForms } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices" };

const TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Waiting for approval" },
  { key: "active", label: "Registered" },
  { key: "suspended", label: "Suspended" },
  { key: "removed", label: "Removed" },
] as const;
const TONE = { pending: "info", active: "ok", suspended: "warn", removed: "neu" } as const;
const STATUS_LABEL = { pending: "Waiting for approval", active: "Registered", suspended: "Suspended", removed: "Removed" } as const;
const CLASS_LABEL: Record<string, string> = { floor_shared: "Shared floor device", personal: "Personal phone", managed_tablet: "Managed tablet" };

/** US-7-06: device registrations per site; approve with offline workflows, suspend or remove with a reason. */
export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.device.view")) return <Forbidden what="device registrations" />;
  const { status = "" } = await searchParams;
  const rows = await listDevices(ctx, { status: status || null });
  const now = Date.now();
  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Phones and tablets registered for offline work at your sites. A device runs a workflow offline only when it is granted here and allowed by the site's offline policy (Settings › Offline)."
      />
      <nav aria-label="Device status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key ? `/admin/devices?status=${t.key}` : "/admin/devices"} aria-current={status === t.key ? "page" : undefined} className={cx("rounded-full border px-3.5 py-1.5 text-[13px]", status === t.key ? "border-primary bg-primary-soft font-semibold" : "border-line")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No devices here">A person asks for registration from the device itself, on the Sync page. Requests then wait here for approval.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="device-list">
            {rows.map((d) => {
              const stale = d.status === "active" && (!d.lastSyncAt || now - new Date(d.lastSyncAt).getTime() > 24 * 3_600_000);
              return (
                <li key={d.id} className="py-3" data-testid={`device-${d.label}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{d.label}</p>
                      <p className="text-[12px] text-muted">
                        {d.siteCode} · {CLASS_LABEL[d.deviceClass] ?? d.deviceClass} · {d.platform}
                        {d.browser ? ` / ${d.browser}` : ""} · requested by {d.requestedByName} {fmtDateTime(d.requestedAt)}
                      </p>
                      <p className="text-[12px] text-muted">
                        Last seen {d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : "never"} · last sync {d.lastSyncAt ? fmtDateTime(d.lastSyncAt) : "never"} · offline data {d.lastReferenceRefreshAt ? fmtDateTime(d.lastReferenceRefreshAt) : "never"}
                        {d.maxClockSkewSeenSeconds > 600 ? ` · clock off by up to ${Math.round(d.maxClockSkewSeenSeconds / 60)} min` : ""}
                      </p>
                      {d.status === "active" && <p className="text-[12px] text-fg-2">Offline: {d.allowedOfflineWorkflows.length ? d.allowedOfflineWorkflows.map((w) => WORKFLOW_LABEL[w]).join(", ") : "nothing granted"}</p>}
                      {d.statusReason && <p className="text-[12px] text-muted">Reason: {d.statusReason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Chip tone={TONE[d.status]}>{STATUS_LABEL[d.status]}</Chip>
                      {stale && <Chip tone="warn">No sync for 24 h</Chip>}
                    </div>
                  </div>
                  {d.canAdmin && d.status !== "removed" && <DeviceForms device={{ id: d.id, label: d.label, status: d.status, deviceClass: d.deviceClass, isManaged: d.isManaged, workflows: d.allowedOfflineWorkflows }} workflows={BUILT_OFFLINE_WORKFLOWS.map((w) => ({ code: w, label: WORKFLOW_LABEL[w] }))} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
